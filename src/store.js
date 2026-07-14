'use strict';

const fs = require('fs');
const path = require('path');
const { REPORTS, PROPERTIES, DIVISION_COUNTS } = require('./data/reports');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

// ── Workflow stages: the sign-off chain ────────────────────────────────────
// A report moves prep → review → signoff → released, one signee at a time.
// A signee only sees a report's working content (financials, findings,
// dispositions, sign-off) once it has reached their stage; whatever an earlier
// signee is still working on stays off the downstream pages until it is handed
// off. This is the generalization of the owner-rep release gate to every step.
const STAGE_ORDER = ['prep', 'review', 'signoff', 'released'];
const STAGE_BY_ROLE = { Accountant: 'prep', Reviewer: 'review', Supervisor: 'signoff', 'Owner Representative': 'released' };
const ROLE_BY_STAGE = { prep: 'Accountant', review: 'Reviewer', signoff: 'Supervisor', released: 'Owner Representative' };
const STAGE_LABEL = { prep: 'In preparation', review: 'In review', signoff: 'Awaiting sign-off', released: 'Released' };
const HOLDER_LABEL = { prep: 'Property Accountant', review: 'Property Manager', signoff: 'Accounting Supervisor', released: 'Owner Representative' };
const stageIndex = (stage) => { const i = STAGE_ORDER.indexOf(stage); return i < 0 ? 0 : i; };
const roleStageIndex = (role) => stageIndex(STAGE_BY_ROLE[role] || 'review');

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
    stages: {}, // reportId -> { stage, at, by, role, history[] } — the sign-off chain position
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
      if (!_store.stages) _store.stages = {}; // backfill workflow stages
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
      if (ensureStages(_store)) save(); // seed a stage for any report that predates the sign-off chain
      return _store;
    }
  } catch (e) {
    console.warn('store load failed, starting fresh:', e.message);
  }
  _store = freshStore();
  ensureStages(_store);
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

// ── Workflow stage (sign-off chain) ────────────────────────────────────────
/** Where a report should sit for a store that predates explicit stages — derive
 *  from whatever lifecycle it already has, falling back to its draft status. */
function initialStageForReport(s, reportId) {
  if (s.sends && s.sends[reportId]) return 'released';
  if (s.signoffs && s.signoffs[reportId]) return 'signoff';
  if ((s.reviews && s.reviews[reportId]) || (s.dispositions && s.dispositions[reportId] && Object.keys(s.dispositions[reportId]).length)) return 'review';
  const rep = s.reports[reportId];
  if (rep && rep.status === 'signed_off') return 'signoff';
  if (rep && rep.status === 'draft_pending_signoff') return 'review';
  return 'prep';
}

/** Make sure every report has a stage record. Returns how many were seeded. */
function ensureStages(s) {
  if (!s.stages) s.stages = {};
  let added = 0;
  for (const id of Object.keys(s.reports)) {
    if (!s.stages[id]) { s.stages[id] = { stage: initialStageForReport(s, id), at: null, by: null, role: null, history: [] }; added += 1; }
  }
  return added;
}

const getStage = (reportId) => { const s = load(); ensureStages(s); const r = s.stages[reportId]; return r ? r.stage : 'prep'; };
const getStageRecord = (reportId) => { const s = load(); ensureStages(s); return s.stages[reportId] || { stage: 'prep', history: [] }; };
/** Has the report reached this role's stage? (upstream + current can see it) */
const canView = (reportId, role) => stageIndex(getStage(reportId)) >= roleStageIndex(role);
/** Is this role the one currently holding the report? (only they may act) */
const isHolder = (reportId, role) => getStage(reportId) === STAGE_BY_ROLE[role];

function setStage(reportId, stage, { by, role }) {
  const s = load();
  ensureStages(s);
  const rec = s.stages[reportId] || (s.stages[reportId] = { stage: 'prep', history: [] });
  const from = rec.stage;
  rec.stage = stage;
  rec.at = new Date().toISOString();
  rec.by = by;
  rec.role = role;
  rec.history.push({ from, to: stage, by, role, at: rec.at });
  save();
  return rec;
}

/**
 * Hand a report forward one internal step (prep → review, review → signoff).
 * Only the current holder may release it, and the review must be clean before
 * it reaches the supervisor. (signoff → released is the send-to-owner path.)
 */
function handoff(reportId, { by, role }) {
  const s = load();
  const stage = getStage(reportId);
  if (role !== ROLE_BY_STAGE[stage]) return { error: 'not_holder', stage };
  const nextStage = STAGE_ORDER[stageIndex(stage) + 1];
  if (!nextStage || stage === 'signoff') return { error: 'no_forward', stage };
  if (nextStage === 'signoff') {
    if (!s.reviews[reportId]) return { error: 'no_review' };
    const { open } = blockingFindings(reportId);
    if (open.length) return { error: 'blocked', open };
  }
  setStage(reportId, nextStage, { by, role });
  const rep = s.reports[reportId];
  audit({ type: 'handoff', by, role, propertyId: rep ? rep.propertyId : null, reportId, detail: `Handed off — ${HOLDER_LABEL[stage]} → ${HOLDER_LABEL[nextStage]}` });
  return { stage: nextStage };
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
  setStage(reportId, 'released', { by, role }); // final handoff: the owner rep can now see it
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
  // A freshly imported draft starts with the property accountant — a review or
  // sign-off of the prior report does not carry over to the new one.
  s.stages[report.id] = { stage: 'prep', at: new Date().toISOString(), by: addedBy, role, history: [] };
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
  getStage,
  getStageRecord,
  canView,
  isHolder,
  handoff,
  STAGE_ORDER,
  STAGE_LABEL,
  HOLDER_LABEL,
  ROLE_BY_STAGE,
  stageIndex,
  roleStageIndex,
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
