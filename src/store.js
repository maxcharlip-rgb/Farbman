'use strict';

const fs = require('fs');
const path = require('path');
const { REPORTS, PROPERTIES, DIVISION_COUNTS } = require('./data/reports');

// Paths are env-overridable so a deploy can point them at a persistent disk
// (Render free-tier's default filesystem is ephemeral — it resets on every
// deploy and after idle, which would silently wipe all review data).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STORE_PATH = process.env.STORE_PATH || path.join(DATA_DIR, 'store.json');

// The four workflow roles. Each person signs in as their role and does their
// own AI-assisted review pass; their dispositions stay a private draft until
// they submit, so one signee's in-progress work never shows on another's page.
const ROLES = ['Accountant', 'Reviewer', 'Supervisor', 'Owner Representative'];

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
    dispositions: {}, // reportId -> role -> findingId -> { action, note, by, at } (per-role, private until submitted)
    submissions: {}, // reportId -> role -> { by, at, count } — this role published its pass to the team
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
    chat: [], // cross-department team chat [{ id, by, role, text, propertyId, at }] — internal roles only
  };
}

let _store = null;

/**
 * Migrate any legacy flat dispositions (reportId -> findingId -> disp, from the
 * pre-per-role model) into reportId -> role -> findingId -> disp, and mark those
 * passes as already submitted so prior decisions stay visible.
 */
function migrateDispositions(s) {
  if (!s.dispositions) { s.dispositions = {}; return; }
  if (!s.submissions) s.submissions = {};
  for (const [rid, m] of Object.entries(s.dispositions)) {
    const vals = Object.values(m || {});
    const isFlat = vals.some((v) => v && typeof v === 'object' && typeof v.action === 'string');
    if (!isFlat) continue;
    const byRole = {};
    for (const [fid, d] of Object.entries(m)) {
      const r = d.role || 'Reviewer';
      (byRole[r] = byRole[r] || {})[fid] = { action: d.action, note: d.note || '', by: d.by, at: d.at };
    }
    s.dispositions[rid] = byRole;
    s.submissions[rid] = s.submissions[rid] || {};
    for (const r of Object.keys(byRole)) {
      if (s.submissions[rid][r]) continue;
      const first = Object.values(byRole[r])[0];
      s.submissions[rid][r] = { by: first.by, at: first.at || null, count: Object.keys(byRole[r]).length };
    }
  }
}

function load() {
  if (_store) return _store;
  try {
    if (fs.existsSync(STORE_PATH)) {
      _store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (!_store.sends) _store.sends = {}; // backfill for stores written before this field
      if (!_store.submissions) _store.submissions = {}; // backfill per-role submissions
      if (!_store.chat) _store.chat = {}; // backfill team chat
      if (!Array.isArray(_store.chat)) _store.chat = []; // (and normalize the shape)
      if (!_store.connector) _store.connector = freshStore().connector; // backfill data-source connector
      delete _store.stages; // the sequential sign-off chain was replaced by per-role draft/submit
      migrateDispositions(_store);
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
      save(); // persist backfills/migration
      return _store;
    }
  } catch (e) {
    // The store file exists but is unreadable/corrupt. Do NOT silently overwrite
    // it with fresh fixtures — that would discard recoverable data. Move it aside
    // loudly so it can be inspected, then start fresh.
    try {
      const aside = `${STORE_PATH}.corrupt-${Date.now()}`;
      if (fs.existsSync(STORE_PATH)) fs.renameSync(STORE_PATH, aside);
      console.error(`store load FAILED (${e.message}). Moved the unreadable store to ${aside} and started fresh — data was NOT overwritten in place.`);
    } catch (e2) {
      console.error(`store load failed (${e.message}) and could not move it aside (${e2.message}); starting fresh.`);
    }
  }
  _store = freshStore();
  save();
  return _store;
}

function save() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  // Atomic write: serialize to a temp file, keep a .bak of the last good store,
  // then rename into place (rename is atomic on the same filesystem) so a crash
  // mid-write can never leave a half-written, unparseable store.json.
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(_store, null, 2));
  try { if (fs.existsSync(STORE_PATH)) fs.copyFileSync(STORE_PATH, `${STORE_PATH}.bak`); } catch { /* best-effort backup */ }
  fs.renameSync(tmp, STORE_PATH);
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

// ── Per-role dispositions + submission ─────────────────────────────────────
/** One role's own dispositions on a report (their private draft or submitted pass). */
const roleDispositions = (reportId, role) => (load().dispositions[reportId] || {})[role] || {};
/** Has this role published (submitted) their pass? */
const isSubmitted = (reportId, role) => !!(load().submissions[reportId] || {})[role];
const getSubmission = (reportId, role) => (load().submissions[reportId] || {})[role] || null;

/**
 * What a given viewer is allowed to see on a report: their own dispositions
 * (draft or submitted) plus every OTHER role's dispositions that have been
 * submitted. An unsubmitted pass by another role is invisible — that's the
 * isolation: your in-progress work doesn't show on anyone else's page.
 */
function dispositionsView(reportId, viewerRole) {
  const all = load().dispositions[reportId] || {};
  const subs = load().submissions[reportId] || {};
  const mine = all[viewerRole] || {};
  const others = {}; // findingId -> [{ role, action, note, by, at }]
  for (const [role, fmap] of Object.entries(all)) {
    if (role === viewerRole || !subs[role]) continue;
    for (const [fid, d] of Object.entries(fmap)) {
      (others[fid] = others[fid] || []).push({ role, action: d.action, note: d.note, by: d.by, at: d.at });
    }
  }
  const submittedRoles = Object.keys(subs).filter((r) => r !== viewerRole).map((r) => ({ role: r, at: subs[r].at, by: subs[r].by }));
  return { mine, others, submittedByMe: !!subs[viewerRole], submittedByMeAt: subs[viewerRole] ? subs[viewerRole].at : null, submittedRoles };
}

// ── Team chat (cross-department; internal roles only — enforced at the API) ──
const CHAT_CAP = 500; // keep the store bounded

function addChatMessage({ by, role, text, propertyId }) {
  const s = load();
  const msg = {
    id: `msg_${Date.now().toString(36)}_${s.chat.length}`,
    by, role,
    text: String(text).slice(0, 2000),
    propertyId: propertyId || null,
    at: new Date().toISOString(),
  };
  s.chat.push(msg);
  if (s.chat.length > CHAT_CAP) s.chat = s.chat.slice(-CHAT_CAP);
  save();
  return msg;
}

/** Latest messages (chronological). Pass `after` (a message id) to get only newer ones. */
function getChat({ limit = 200, after = null } = {}) {
  const all = load().chat;
  if (after) {
    const i = all.findIndex((m) => m.id === after);
    if (i >= 0) return all.slice(i + 1);
  }
  return all.slice(-limit);
}

function saveReview(reportId, review, ranBy, role) {
  const s = load();
  const reviewId = `rv_${Date.now().toString(36)}`;
  s.reviews[reportId] = { reviewId, ranAt: new Date().toISOString(), ranBy, role, summary: review.summary, findings: review.findings, property: review.property };
  // Re-running invalidates a prior sign-off — the findings it certified may have changed.
  if (s.signoffs[reportId]) delete s.signoffs[reportId];
  save();
  audit({ type: 'review_run', by: ranBy, role, propertyId: review.property.propertyId, reportId, detail: `Ran first-pass review (${review.summary.problems} open items)` });
  return s.reviews[reportId];
}

function setDisposition(reportId, findingId, { action, note, by, role }) {
  const s = load();
  if (!s.dispositions[reportId]) s.dispositions[reportId] = {};
  if (!s.dispositions[reportId][role]) s.dispositions[reportId][role] = {};
  s.dispositions[reportId][role][findingId] = { action, note: note || '', by, at: new Date().toISOString() };
  // A supervisor changing their OWN pass after signing off invalidates that sign-off.
  if (role === 'Supervisor' && s.signoffs[reportId]) delete s.signoffs[reportId];
  save();
  const review = s.reviews[reportId];
  const f = review && review.findings.find((x) => x.id === findingId);
  audit({ type: 'disposition', by, role, propertyId: review ? review.property.propertyId : null, reportId, detail: `${action.toUpperCase()} — ${f ? f.title : findingId}${note ? ` · "${note}"` : ''}` });
  return s.dispositions[reportId][role][findingId];
}

/** Publish this role's pass so the rest of the team can see its dispositions. */
function submitReview(reportId, { by, role }) {
  const s = load();
  if (!s.reviews[reportId]) return { error: 'no_review' };
  if (!s.submissions[reportId]) s.submissions[reportId] = {};
  const count = Object.keys((s.dispositions[reportId] || {})[role] || {}).length;
  s.submissions[reportId][role] = { by, at: new Date().toISOString(), count };
  save();
  audit({ type: 'review_submitted', by, role, propertyId: s.reviews[reportId].property.propertyId, reportId, detail: `Submitted review — ${count} finding${count === 1 ? '' : 's'} dispositioned, now visible to the team` });
  return s.submissions[reportId][role];
}

/** Findings a given role still must disposition (open exceptions + second-opinion items). */
function blockingFindings(reportId, role) {
  const review = getReview(reportId);
  if (!review) return { error: 'no_review' };
  const disp = roleDispositions(reportId, role);
  const need = review.findings.filter((f) => f.passed === false || f.tier === 'escalate');
  const open = need.filter((f) => !disp[f.id]);
  return { need, open };
}

function signOff(reportId, { by, role }) {
  const s = load();
  const review = s.reviews[reportId];
  if (!review) return { error: 'no_review' };
  const { open } = blockingFindings(reportId, role); // the supervisor signs off on their OWN pass
  if (open.length) return { error: 'blocked', open };
  const disp = roleDispositions(reportId, role);
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
  // Validate the shape BEFORE mutating anything, so a malformed report object
  // (e.g. posted straight to /api/import) can't half-create a junk property and
  // then throw, corrupting the store.
  if (!report || typeof report !== 'object') throw new Error('report must be an object');
  const missing = ['id', 'propertyId', 'property'].filter((k) => !report[k]);
  if (!report.period || !report.period.month) missing.push('period.month');
  if (missing.length) throw new Error(`report is missing required field(s): ${missing.join(', ')}`);

  const s = load();
  s.reports[report.id] = report;
  // A re-imported draft is a fresh document: clear any prior run's review,
  // dispositions, submissions, sign-off and release for this id so stale state
  // can't masquerade as work already done on the new draft.
  delete s.reviews[report.id];
  delete s.dispositions[report.id];
  delete s.submissions[report.id];
  delete s.signoffs[report.id];
  delete s.sends[report.id];
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
  // Safety floor: a truncated/garbage feed (e.g. an HTML error page that slipped
  // through) would otherwise deactivate the entire real roster. Refuse to
  // deactivate more than half of the active managed roster in a single sync.
  const managedActive = s.properties.filter((p) => p.code && p.status !== 'inactive');
  const wouldDeactivate = managedActive.filter((p) => !seen.has(key(p.code)));
  if (managedActive.length >= 4 && wouldDeactivate.length > Math.ceil(managedActive.length / 2)) {
    throw new Error(`refusing to sync: this list would deactivate ${wouldDeactivate.length} of ${managedActive.length} active properties — it looks truncated or wrong, so the roster was left unchanged`);
  }
  for (const p of wouldDeactivate) {
    p.status = 'inactive';
    deactivated.push({ code: p.code, name: p.name });
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
  for (const [reportId, byRoleMap] of Object.entries(s.dispositions)) {
    const review = s.reviews[reportId];
    for (const fmap of Object.values(byRoleMap)) {
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
  ROLES,
  load,
  save,
  audit,
  getReport,
  getChain,
  getProperties,
  getProperty,
  getReview,
  getSignoff,
  getSent,
  getAuditFor,
  getConnector,
  setConnector,
  addChatMessage,
  getChat,
  roleDispositions,
  isSubmitted,
  getSubmission,
  dispositionsView,
  saveReview,
  setDisposition,
  submitReview,
  blockingFindings,
  signOff,
  sendToOwnerRep,
  upsertReport,
  syncProperties,
  calibration,
  STORE_PATH,
};
