'use strict';

const path = require('path');
const express = require('express');
const store = require('./src/store');
const { DIVISION_BLURBS, PROPERTY_LIST_TEMPLATE, SAMPLE_PROPERTY_LIST } = require('./src/data/reports');
const { runReview } = require('./src/engine');
const { generateBriefing } = require('./src/llm');
const { parseCsv, CSV_TEMPLATE, CSV_SAMPLE, parsePropertyList } = require('./src/ingest');
const { buildReportDocx, contentDisposition } = require('./src/export/word');
const connector = require('./src/connector');
const outlook = require('./src/outlook');

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.text({ type: 'text/csv', limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Identity is passed from the UI role switcher (prototype — no real auth). The
// role rides on the request body (POSTs), a query param, or an x-role header
// (GETs) so each signee's reads reflect their own review pass.
function actor(req) {
  const role = (req.body && req.body.role) || req.query.role || req.get('x-role') || 'Reviewer';
  const by = (req.body && req.body.user) || req.query.user || req.get('x-user') || roleName(role);
  return { role, by };
}
function roleName(role) {
  return { Accountant: 'A. Accountant', Reviewer: 'L. Reviewer', Supervisor: 'D. Okafor (Supervisor)', 'Owner Representative': 'Owner Representative' }[role] || role;
}

// The owner rep only receives the RELEASED package — everything else about a
// report (draft, findings, trend, briefing, export) stays internal until then.
function ownerRepBlocked(req, reportId) {
  return actor(req).role === 'Owner Representative' && reportId && !store.getSent(reportId);
}

// An unsubmitted disposition is private to its author, so hide other roles'
// unsubmitted disposition events from the audit trail a viewer sees.
function visibleAudit(events, role) {
  return events.filter((a) => !(a.type === 'disposition' && a.role && a.role !== role && a.reportId && !store.isSubmitted(a.reportId, a.role)));
}

// ── Portfolio dashboard ────────────────────────────────
// Status is per-viewer: it reflects the signed-in role's own review pass.
function statusOf(reportId, role) {
  const review = store.getReview(reportId);
  if (!review) return { state: 'not_run', label: 'Not reviewed' };
  if (role === 'Owner Representative') {
    return store.getSent(reportId) ? { state: 'signed_off', label: 'Delivered to you' } : { state: 'in_review', label: 'Not yet released' };
  }
  if (store.getSignoff(reportId)) return { state: 'signed_off', label: 'Signed off' };
  const { open } = store.blockingFindings(reportId, role);
  if (open.length) return { state: 'in_review', label: `${open.length} item${open.length === 1 ? '' : 's'} to clear` };
  return { state: 'ready', label: store.isSubmitted(reportId, role) ? 'Review submitted' : 'Ready to submit' };
}

app.get('/api/portfolio', (req, res) => {
  connector.maybePoll(); // keep the roster current on idle/free hosts (non-blocking)
  const { role } = actor(req);
  const props = store.getProperties().map((p) => {
    const review = store.getReview(p.currentReportId);
    const report = store.getReport(p.currentReportId);
    return {
      id: p.id,
      code: p.code || null,
      rosterStatus: p.status || 'active',
      name: p.name,
      division: p.division,
      currentReportId: p.currentReportId,
      period: report ? report.period : null,
      status: statusOf(p.currentReportId, role),
      summary: review ? review.summary : null,
      reviewedAt: review ? review.ranAt : null,
      signoff: store.getSignoff(p.currentReportId),
      sent: store.getSent(p.currentReportId),
      submitted: p.currentReportId ? store.isSubmitted(p.currentReportId, role) : false,
      ownerRep: p.ownerRep || null,
    };
  });
  // Counts reflect the live roster (active properties), not the hardcoded seed.
  const divisionCounts = {};
  for (const p of store.getProperties()) {
    if (p.status === 'inactive') continue;
    divisionCounts[p.division] = (divisionCounts[p.division] || 0) + 1;
  }
  res.json({ divisionCounts, divisionBlurbs: DIVISION_BLURBS, properties: props, llmEnabled: !!process.env.ANTHROPIC_API_KEY });
});

// ── Single report + everything attached to it ──────────
app.get('/api/property/:id', (req, res) => {
  const prop = store.getProperty(req.params.id);
  if (!prop) return res.status(404).json({ error: 'property not found' });
  const { role } = actor(req);
  const reportId = prop.currentReportId;
  // The owner representative RECEIVES the finished package — the draft, findings,
  // and in-progress review stay off their page until the team releases it.
  if (ownerRepBlocked(req, reportId)) {
    return res.json({
      property: { id: prop.id, name: prop.name, division: prop.division, code: prop.code || null, ownerRep: prop.ownerRep || null },
      report: null, review: null, dispositions: { mine: {}, others: {}, submittedRoles: [] },
      signoff: null, sent: null, ownerRep: prop.ownerRep || null, blocking: null, audit: [],
      role, canDispose: false, notReleased: true,
    });
  }
  const report = store.getReport(reportId);
  const review = store.getReview(reportId);
  res.json({
    property: prop,
    report,
    review,
    // Your own dispositions (draft or submitted) + only the SUBMITTED passes of
    // other roles — an unsubmitted pass never appears on another signee's page.
    dispositions: store.dispositionsView(reportId, role),
    signoff: store.getSignoff(reportId),
    sent: store.getSent(reportId),
    ownerRep: prop.ownerRep || null,
    blocking: review ? store.blockingFindings(reportId, role) : null,
    audit: visibleAudit(store.getAuditFor(prop.id), role),
    role,
    canDispose: role !== 'Owner Representative',
  });
});

app.get('/api/report/:id', (req, res) => {
  const report = store.getReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'report not found' });
  if (ownerRepBlocked(req, req.params.id)) return res.status(403).json({ error: 'This report has not been released to you yet.' });
  res.json(report);
});

// ── Export the report as a Word (.docx) document to send out ──
app.get('/api/export/:propertyId', async (req, res) => {
  const prop = store.getProperty(req.params.propertyId);
  if (!prop) return res.status(404).json({ error: 'property not found' });
  if (ownerRepBlocked(req, prop.currentReportId))
    return res.status(403).json({ error: 'This report has not been released to you yet.' });
  const report = store.getReport(prop.currentReportId);
  if (!report) return res.status(404).json({ error: 'report not found' });
  try {
    const buf = await buildReportDocx(report, {
      property: prop,
      signoff: store.getSignoff(prop.currentReportId),
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', contentDisposition(report));
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: 'could not build document: ' + e.message });
  }
});

// ── Run the first-pass review — every internal role can run it for their pass ──
app.post('/api/review', (req, res) => {
  const { propertyId } = req.body || {};
  const prop = store.getProperty(propertyId);
  if (!prop) return res.status(404).json({ error: 'property not found' });
  const report = store.getReport(prop.currentReportId);
  if (!report) return res.status(404).json({ error: 'report not found' });
  const { by, role } = actor(req);
  if (role === 'Owner Representative') return res.status(403).json({ error: 'The owner representative receives the report — switch to an internal role to run the review.' });
  const prior = report.priorReportId ? store.getReport(report.priorReportId) : null;
  const review = runReview(report, prior);
  const saved = store.saveReview(report.id, review, by, role);
  res.json({ ...review, reviewId: saved.reviewId, ranAt: saved.ranAt });
});

// Review an arbitrary report pushed inline (integration path; not persisted).
app.post('/api/review/inline', (req, res) => {
  const { report, prior, policy } = req.body || {};
  if (!report) return res.status(400).json({ error: 'report is required' });
  try {
    res.json(runReview(report, prior || null, policy || {}));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Disposition a finding (into your own private pass) ─────────────────────
app.post('/api/disposition', (req, res) => {
  const { reportId, findingId, action, note } = req.body || {};
  if (!reportId || !findingId || !action) return res.status(400).json({ error: 'reportId, findingId, action required' });
  if (!['accept', 'dismiss', 'resolve'].includes(action)) return res.status(400).json({ error: 'invalid action' });
  const { by, role } = actor(req);
  if (role === 'Owner Representative') return res.status(403).json({ error: 'The owner representative receives a read-only package and does not disposition findings.' });
  const review = store.getReview(reportId);
  if (!review) return res.status(409).json({ error: 'run the first-pass review before dispositioning findings' });
  if (!review.findings.some((f) => f.id === findingId)) return res.status(400).json({ error: 'unknown findingId for this report' });
  const d = store.setDisposition(reportId, findingId, { action, note, by, role });
  res.json({ disposition: d, blocking: store.blockingFindings(reportId, role) });
});

// ── Submit your review — publish your pass so the team can see it ──
app.post('/api/submit', (req, res) => {
  const { reportId } = req.body || {};
  const { by, role } = actor(req);
  if (role === 'Owner Representative') return res.status(403).json({ error: 'The owner representative receives the report and has no review to submit.' });
  const result = store.submitReview(reportId, { by, role });
  if (result.error === 'no_review') return res.status(409).json({ error: 'Run the first-pass review before submitting.' });
  res.json({ submission: result });
});

// ── Supervisor sign-off (gated on the supervisor's own pass) ────────────────
app.post('/api/signoff', (req, res) => {
  const { reportId } = req.body || {};
  const { by, role } = actor(req);
  if (role !== 'Supervisor') return res.status(403).json({ error: 'Only a Supervisor can sign off. Switch role to Supervisor.' });
  const result = store.signOff(reportId, { by, role });
  if (result.error === 'no_review') return res.status(409).json({ error: 'Run the first-pass review before signing off.' });
  if (result.error === 'blocked')
    return res.status(409).json({ error: 'blocked', message: 'Disposition every open exception and second-opinion item in your review before signing off.', open: result.open.map((f) => ({ id: f.id, title: f.title, tier: f.tier })) });
  res.json({ signoff: result });
});

// ── Release the signed-off report to the owner representative ──
app.post('/api/send-to-owner', (req, res) => {
  const { propertyId } = req.body || {};
  const { by, role } = actor(req);
  if (role === 'Owner Representative')
    return res.status(403).json({ error: 'The owner representative receives the report. Switch to an internal role to release it.' });
  const prop = store.getProperty(propertyId);
  if (!prop) return res.status(404).json({ error: 'property not found' });
  const result = store.sendToOwnerRep(prop.currentReportId, { by, role, to: prop.ownerRep || null });
  if (result.error === 'no_review') return res.status(409).json({ error: 'Run and sign off the review before sending.' });
  if (result.error === 'not_signed_off')
    return res.status(409).json({ error: 'Sign off the report before releasing it to the owner representative.' });
  res.json({ sent: result });
});

// ── Import a draft report ──────────────────────────────
app.get('/api/import/template', (req, res) => {
  res.type('text/csv').send(CSV_TEMPLATE);
});
app.get('/api/import/sample', (req, res) => {
  res.type('text/csv').send(CSV_SAMPLE);
});

app.post('/api/import', (req, res) => {
  const { by, role } = actor(req);
  try {
    let report;
    if (typeof req.body === 'string') report = parseCsv(req.body); // text/csv
    else if (req.body && req.body.csv) report = parseCsv(req.body.csv);
    else if (req.body && req.body.report) report = req.body.report;
    else return res.status(400).json({ error: 'provide csv text or a report object' });
    const prop = store.upsertReport(report, by, role);
    res.json({ property: prop, report });
  } catch (e) {
    res.status(400).json({ error: 'could not parse report: ' + e.message });
  }
});

// ── Monthly property-code roster sync ──────────────────────────────────────
app.get('/api/properties/template', (req, res) => {
  res.type('text/csv').send(PROPERTY_LIST_TEMPLATE);
});
app.get('/api/properties/sample', (req, res) => {
  res.type('text/csv').send(SAMPLE_PROPERTY_LIST);
});
app.post('/api/properties/sync', (req, res) => {
  const { by, role } = actor(req);
  try {
    let list;
    if (Array.isArray(req.body && req.body.properties)) list = req.body.properties;
    else if (typeof req.body === 'string') list = parsePropertyList(req.body); // text/csv
    else if (req.body && typeof req.body.list === 'string') list = parsePropertyList(req.body.list);
    else return res.status(400).json({ error: 'provide a property list (csv text or a properties array)' });
    if (!list.length) return res.status(400).json({ error: 'no property rows found in the list' });
    const result = store.syncProperties(list, { by, role });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: 'could not sync roster: ' + e.message });
  }
});

// ── Data-source connector (live CSV URL and/or watched folder) ─────────────
app.get('/api/connector', (req, res) => {
  connector.maybePoll(); // opening the page refreshes from the source (non-blocking)
  res.json(connector.status());
});
app.post('/api/connector/poll', async (req, res) => {
  try {
    const result = await connector.pollOnce();
    res.json({ result, status: connector.status() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/connector/config', async (req, res) => {
  const { sourceUrl, pollSeconds, sourceLabel } = req.body || {};
  try {
    connector.setSource({ sourceUrl, pollSeconds, sourceLabel });
    // Sync immediately so the roster reflects the new source right away.
    let result = null;
    if (connector.status().sourceUrl) result = await connector.pollOnce();
    res.json({ status: connector.status(), result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/connector/simulate', (req, res) => {
  try {
    const dropped = connector.simulateDrop();
    res.json({ dropped, status: connector.status() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Multi-month trend (leadership: most useful for receivership properties) ──
app.get('/api/trend/:propertyId', (req, res) => {
  const prop = store.getProperty(req.params.propertyId);
  if (!prop) return res.status(404).json({ error: 'property not found' });
  if (ownerRepBlocked(req, prop.currentReportId)) return res.status(403).json({ error: 'This report has not been released to you yet.' });
  const chain = store.getChain(prop.currentReportId);
  res.json({
    propertyId: prop.id,
    division: prop.division,
    points: chain.map((r) => ({
      month: r.period.month,
      label: r.period.label,
      revenue: r.incomeStatement ? r.incomeStatement.totalRevenue : null,
      expenses: r.incomeStatement ? r.incomeStatement.totalExpenses : null,
      noi: r.incomeStatement ? r.incomeStatement.noiPTD : null,
      endingCash: r.balance ? r.balance.endingCash : null,
      occupancyPct: r.execSummary ? r.execSummary.occupancyPct : null,
      ytdNOI: r.execSummary ? r.execSummary.ytdNOI : null,
    })),
  });
});

// ── Team chat — every seat can talk, including the owner representative ─────
// (Review privacy still holds: unsubmitted dispositions and unreleased reports
// never appear in chat — only what people choose to write.)
app.get('/api/chat', (req, res) => {
  const { role } = actor(req);
  res.json({ messages: store.getChat({ after: req.query.after || null, role }) });
});
app.post('/api/chat', async (req, res) => {
  const { text, propertyId } = req.body || {};
  const { by, role } = actor(req);
  const trimmed = String(text || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'message text is required' });
  const prop = propertyId ? store.getProperty(propertyId) : null;
  if (propertyId && !prop) return res.status(400).json({ error: 'unknown propertyId' });
  // @someone → a direct message only they (and you) can see; @all or no
  // mention → the whole team. The Outlook ping rides along either way.
  const allMentioned = outlook.parseMentions(trimmed);
  const isPublic = /@all\b/i.test(trimmed) || allMentioned.length === 0;
  const to = isPublic ? null : [...new Set([role, ...allMentioned.map((p) => p.role)])];
  const message = store.addChatMessage({ by, role, text: trimmed, propertyId, to });
  const mentioned = allMentioned.filter((p) => p.role !== role); // don't ping yourself
  if (mentioned.length) {
    const pings = await Promise.all(mentioned.map((p) => outlook.ping(p, { from: by, text: trimmed, propertyName: prop ? prop.name : null })));
    store.setChatPings(message.id, pings);
    message.pings = pings;
    for (const p of pings) store.audit({ type: 'outlook_ping', by, role, propertyId: propertyId || null, reportId: null, detail: `Outlook ping → ${p.email} (${p.status})` });
  }
  res.json({ message, outlookConfigured: outlook.configured() });
});

// ── Calibration + audit ────────────────────────────────
app.get('/api/calibration', (req, res) => res.json(store.calibration()));
// The audit trail hides other roles' still-unsubmitted disposition activity.
app.get('/api/audit', (req, res) => {
  const { role } = actor(req);
  res.json(visibleAudit(store.load().audit, role).slice().reverse());
});

// ── Reviewer briefing (Claude if key set, else deterministic) ──
app.post('/api/briefing', async (req, res) => {
  const { propertyId } = req.body || {};
  const prop = store.getProperty(propertyId);
  if (!prop) return res.status(404).json({ error: 'property not found' });
  if (ownerRepBlocked(req, prop.currentReportId)) return res.status(403).json({ error: 'This report has not been released to you yet.' });
  const review = store.getReview(prop.currentReportId);
  if (!review) return res.status(409).json({ error: 'run the review first' });
  try {
    res.json(await generateBriefing(review));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Terminal error handler — turns a malformed JSON body or any uncaught route
// throw into the same JSON error shape the SPA expects, instead of an HTML page
// with a raw stack trace / filesystem paths. Must be last, with four args.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('Unhandled error:', err.stack || err.message);
  const msg = err.type === 'entity.parse.failed' ? 'invalid JSON in request body' : (err.message || 'internal error');
  res.status(status).json({ error: msg });
});

const PORT = process.env.PORT || 4178;
app.listen(PORT, () => {
  console.log(`Farbman first-pass review engine on http://localhost:${PORT}`);
  console.log(`Store: ${store.STORE_PATH}`);
  console.log(`LLM briefing: ${process.env.ANTHROPIC_API_KEY ? 'enabled (Claude)' : 'deterministic fallback'}`);
  connector.startPolling();
  const c = connector.status();
  console.log(`Data source: ${c.sourceLabel} — ${c.sourceUrl ? 'polling URL ' + c.sourceUrl : 'watching ' + c.inbox}, every ${c.pollSeconds}s`);
});
