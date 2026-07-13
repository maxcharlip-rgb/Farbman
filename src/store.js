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
    sends: {}, // reportId -> { by, role, at, to } — released to the owner rep
    connector: { // automated data source (live CSV URL and/or watched folder)
      enabled: true,
      sourceUrl: null, // a published CSV / Google Sheet URL — the self-updating source
      sourceLabel: 'Yardi scheduled export',
      pollSeconds: 30,
      lastPoll: null,
      lastResult: null,
    },
    audit: [], // append-only [{ at, type, by, role, propertyId, reportId, detail }]
  };
}

let _store = null;

function load() {
  if (_store) return _store;
  try {
    if (fs.existsSync(STORE_PATH)) {
      _store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (!_store.sends) _store.sends = {}; // backfill for stores written before this field
      if (!_store.connector) _store.connector = freshStore().connector; // backfill data-source connector
      // make sure newer seed reports/properties are present without clobbering live data
      for (const [id, r] of Object.entries(REPORTS)) if (!_store.reports[id]) _store.reports[id] = JSON.parse(JSON.stringify(r));
      for (const p of PROPERTIES) {
        const existing = _store.properties.find((x) => x.id === p.id);
        if (!existing) _store.properties.push(JSON.parse(JSON.stringify(p)));
        else {
          if (!existing.ownerRep && p.ownerRep) existing.ownerRep = p.ownerRep; // backfill owner rep
          if (!existing.code && p.code) existing.code = p.code; // backfill roster code
        }
      }
      // Every property is roster-active unless explicitly deactivated by a sync.
      for (const p of _store.properties) if (!p.status) p.status = 'active';
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
const getSent = (reportId) => load().sends[reportId] || null;
const getAuditFor = (propertyId) => load().audit.filter((a) => a.propertyId === propertyId);
const getConnector = () => load().connector;
function setConnector(patch) {
  const s = load();
  s.connector = { ...s.connector, ...patch };
  save();
  return s.connector;
}

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

/**
 * Release the reviewed, signed-off report to the owner representative. Prototype:
 * this is a *simulated* send — it records who released it and when, and writes an
 * audit-trail entry. It does not transmit real email (sample data, .example
 * addresses). Gated on sign-off: you only release a report the team has cleared.
 */
function sendToOwnerRep(reportId, { by, role, to }) {
  const s = load();
  const review = s.reviews[reportId];
  if (!review) return { error: 'no_review' };
  if (!s.signoffs[reportId]) return { error: 'not_signed_off' };
  s.sends[reportId] = { by, role, at: new Date().toISOString(), to: to || null };
  save();
  audit({
    type: 'sent_to_owner_rep',
    by,
    role,
    propertyId: review.property.propertyId,
    reportId,
    detail: `Released to owner representative${to ? ` — ${to.name} (${to.email})` : ''}`,
  });
  return s.sends[reportId];
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

/**
 * Reconcile the property roster against the monthly property list (in production,
 * the Yardi property export). Matches on property CODE. Adds new properties,
 * updates changed ones, and marks any active property missing from the list as
 * inactive — non-destructively (data kept; a later list that includes it
 * reactivates it). This is what keeps the tool current without manual re-entry.
 */
function syncProperties(list, { by, role }) {
  const s = load();
  const seen = new Set();
  const added = [];
  const updated = [];
  const unchanged = [];
  const deactivated = [];
  const key = (v) => String(v || '').trim().toUpperCase();

  for (const item of list) {
    const code = String(item.code || '').trim();
    if (!code && !item.name) continue;
    if (code) seen.add(key(code));
    let prop = s.properties.find((p) => (code && key(p.code) === key(code)) || (item.id && p.id === item.id));
    if (!prop) {
      prop = {
        id: item.id || key(code).toLowerCase(),
        code,
        status: 'active',
        name: item.name || code,
        division: item.division || '3rd Party',
        currentReportId: null,
        ownerRep: item.ownerRep || null,
      };
      s.properties.push(prop);
      added.push({ code, name: prop.name, division: prop.division });
    } else {
      const changes = [];
      if (code && key(prop.code) !== key(code)) { prop.code = code; changes.push('code'); }
      if (!prop.code && code) prop.code = code;
      if (item.name && item.name !== prop.name) { prop.name = item.name; changes.push('name'); }
      if (item.division && item.division !== prop.division) { prop.division = item.division; changes.push('division'); }
      if (item.ownerRep && item.ownerRep.name && (!prop.ownerRep || item.ownerRep.name !== prop.ownerRep.name || item.ownerRep.email !== prop.ownerRep.email)) {
        prop.ownerRep = { ...(prop.ownerRep || {}), name: item.ownerRep.name, email: item.ownerRep.email };
        changes.push('owner rep');
      }
      if (prop.status === 'inactive') { changes.push('reactivated'); }
      prop.status = 'active';
      if (changes.length) updated.push({ code: prop.code, name: prop.name, changes });
      else unchanged.push({ code: prop.code, name: prop.name });
    }
  }

  // Anything roster-managed (has a code) and active but absent from this list → inactive.
  for (const p of s.properties) {
    if (p.code && p.status !== 'inactive' && !seen.has(key(p.code))) {
      p.status = 'inactive';
      deactivated.push({ code: p.code, name: p.name });
    }
  }

  save();
  audit({
    type: 'property_sync',
    by,
    role,
    propertyId: null,
    reportId: null,
    detail: `Property roster synced from monthly list — ${added.length} added, ${updated.length} updated, ${deactivated.length} deactivated (${list.length} in list)`,
  });
  return { added, updated, unchanged, deactivated, listCount: list.length, total: s.properties.length };
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
  getSent,
  getAuditFor,
  getConnector,
  setConnector,
  saveReview,
  setDisposition,
  blockingFindings,
  signOff,
  sendToOwnerRep,
  upsertReport,
  syncProperties,
  calibration,
  STORE_PATH,
};
