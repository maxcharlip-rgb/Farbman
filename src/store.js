'use strict';

const fs = require('fs');
const path = require('path');
const { REPORTS, PROPERTIES, DIVISION_COUNTS } = require('./data/reports');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

/**
 * Tiny file-backed store. No external DB so the company can just `npm start`.
 * Holds the full review lifecycle + an append-only audit log, which is the
 * compliance backbone (especially for receivership reports that reach a court).
 */
function freshStore() {
  return {
    version: 1,
    reports: JSON.parse(JSON.stringify(REPORTS)), // seed from fixtures
    properties: JSON.parse(JSON.stringify(PROPERTIES)),
    divisionCounts: { ...DIVISION_COUNTS },
    reviews: {}, // reportId -> latest review run { reviewId, ranAt, ranBy, summary, findings }
    dispositions: {}, // reportId -> findingId -> { action, note, by, role, at }
    signoffs: {}, // reportId -> { by, role, at, snapshot }
    audit: [], // append-only [{ at, type, by, role, propertyId, reportId, detail }]
  };
}

let _store = null;

function load() {
  if (_store) return _store;
  try {
    if (fs.existsSync(STORE_PATH)) {
      _store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      // make sure newer seed reports/properties are present without clobbering live data
      for (const [id, r] of Object.entries(REPORTS)) if (!_store.reports[id]) _store.reports[id] = JSON.parse(JSON.stringify(r));
      for (const p of PROPERTIES) if (!_store.properties.find((x) => x.id === p.id)) _store.properties.push(JSON.parse(JSON.stringify(p)));
      return _store;
    }
  } catch (e) {
    console.warn('store load failed, starting fresh:', e.message);
  }
  _store = freshStore();
  save();
  return _store;
}

function save() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(_store, null, 2));
}

function audit(evt) {
  const s = load();
  s.audit.push({ at: new Date().toISOString(), ...evt });
  save();
}

// ── accessors ──────────────────────────────────────────
const getReport = (id) => load().reports[id] || null;

/** Walk priorReportId links back in time; returns chronological order (oldest first). */
function getChain(reportId, max = 12) {
  const s = load();
  const out = [];
  let r = s.reports[reportId];
  while (r && out.length < max) {
    out.push(r);
    r = r.priorReportId ? s.reports[r.priorReportId] : null;
  }
  return out.reverse();
}
const getProperties = () => load().properties;
const getProperty = (id) => load().properties.find((p) => p.id === id) || null;
const getReview = (reportId) => load().reviews[reportId] || null;
const getDispositions = (reportId) => load().dispositions[reportId] || {};
const getSignoff = (reportId) => load().signoffs[reportId] || null;
const getAuditFor = (propertyId) => load().audit.filter((a) => a.propertyId === propertyId);

function saveReview(reportId, review, ranBy, role) {
  const s = load();
  const reviewId = `rv_${Date.now().toString(36)}`;
  s.reviews[reportId] = { reviewId, ranAt: new Date().toISOString(), ranBy, role, summary: review.summary, findings: review.findings, property: review.property };
  // Re-running invalidates a prior sign-off (the underlying findings may have changed).
  if (s.signoffs[reportId]) delete s.signoffs[reportId];
  save();
  audit({ type: 'review_run', by: ranBy, role, propertyId: review.property.propertyId, reportId, detail: `Ran first-pass review (${review.summary.problems} open items)` });
  return s.reviews[reportId];
}

function setDisposition(reportId, findingId, { action, note, by, role }) {
  const s = load();
  if (!s.dispositions[reportId]) s.dispositions[reportId] = {};
  s.dispositions[reportId][findingId] = { action, note: note || '', by, role, at: new Date().toISOString() };
  // Dispositioning after a sign-off invalidates it.
  if (s.signoffs[reportId]) delete s.signoffs[reportId];
  save();
  const review = s.reviews[reportId];
  const f = review && review.findings.find((x) => x.id === findingId);
  audit({ type: 'disposition', by, role, propertyId: review ? review.property.propertyId : null, reportId, detail: `${action.toUpperCase()} — ${f ? f.title : findingId}${note ? ` · "${note}"` : ''}` });
  return s.dispositions[reportId][findingId];
}

/** Findings that must be dispositioned before sign-off: open exceptions + every second-opinion item. */
function blockingFindings(reportId) {
  const review = getReview(reportId);
  if (!review) return { error: 'no_review' };
  const disp = getDispositions(reportId);
  const need = review.findings.filter((f) => f.passed === false || f.tier === 'escalate');
  const open = need.filter((f) => !disp[f.id]);
  return { need, open };
}

function signOff(reportId, { by, role }) {
  const s = load();
  const review = s.reviews[reportId];
  if (!review) return { error: 'no_review' };
  const { open } = blockingFindings(reportId);
  if (open.length) return { error: 'blocked', open };
  const disp = getDispositions(reportId);
  const snapshot = {
    summary: review.summary,
    dispositions: review.findings.map((f) => ({ id: f.id, title: f.title, tier: f.tier, passed: f.passed, disposition: disp[f.id] || null })),
  };
  s.signoffs[reportId] = { by, role, at: new Date().toISOString(), snapshot };
  save();
  audit({ type: 'signoff', by, role, propertyId: review.property.propertyId, reportId, detail: `Supervisor sign-off recorded` });
  return s.signoffs[reportId];
}

function upsertReport(report, addedBy, role) {
  const s = load();
  s.reports[report.id] = report;
  let prop = s.properties.find((p) => p.id === report.propertyId);
  if (!prop) {
    prop = { id: report.propertyId, name: report.property, division: report.division, currentReportId: report.id };
    s.properties.push(prop);
  } else {
    prop.currentReportId = report.id;
    prop.name = report.property;
    prop.division = report.division;
  }
  save();
  audit({ type: 'import', by: addedBy, role, propertyId: report.propertyId, reportId: report.id, detail: `Imported draft: ${report.property} (${report.period.label})` });
  return prop;
}

/** Calibration: how reviewers acted on each rule's findings — the "is this rule earning its keep" loop. */
function calibration() {
  const s = load();
  const byRule = {};
  let accepted = 0;
  let dismissed = 0;
  let resolved = 0;
  for (const [reportId, fmap] of Object.entries(s.dispositions)) {
    const review = s.reviews[reportId];
    for (const [findingId, d] of Object.entries(fmap)) {
      const f = review && review.findings.find((x) => x.id === findingId);
      const rule = f ? f.rule : findingId.split(':')[0];
      const row = (byRule[rule] = byRule[rule] || { rule, accepted: 0, dismissed: 0, resolved: 0, total: 0 });
      row[d.action] = (row[d.action] || 0) + 1;
      row.total += 1;
      if (d.action === 'accept') accepted += 1;
      if (d.action === 'dismiss') dismissed += 1;
      if (d.action === 'resolve') resolved += 1;
    }
  }
  const totalActed = accepted + dismissed + resolved;
  const useful = accepted + resolved;
  return {
    overall: {
      totalActed,
      useful,
      dismissed,
      usefulRate: totalActed ? useful / totalActed : null,
    },
    byRule: Object.values(byRule).sort((a, b) => b.total - a.total),
  };
}

module.exports = {
  load,
  save,
  audit,
  getReport,
  getChain,
  getProperties,
  getProperty,
  getReview,
  getDispositions,
  getSignoff,
  getAuditFor,
  saveReview,
  setDisposition,
  blockingFindings,
  signOff,
  upsertReport,
  calibration,
  STORE_PATH,
};
