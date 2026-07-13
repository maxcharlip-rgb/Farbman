'use strict';

const path = require('path');
const express = require('express');
const store = require('./src/store');
const { DIVISION_BLURBS } = require('./src/data/reports');
const { runReview } = require('./src/engine');
const { generateBriefing } = require('./src/llm');
const { parseCsv, CSV_TEMPLATE } = require('./src/ingest');

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.text({ type: 'text/csv', limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Identity is passed from the UI role switcher (prototype — no real auth).
function actor(req) {
  const role = (req.body && req.body.role) || req.query.role || 'Reviewer';
  const by = (req.body && req.body.user) || req.query.user || roleName(role);
  return { role, by };
}
function roleName(role) {
  return { Accountant: 'A. Accountant', Reviewer: 'L. Reviewer', Supervisor: 'D. Okafor (Supervisor)', 'Owner Representative': 'Owner Representative' }[role] || role;
}

// ── Portfolio dashboard ────────────────────────────────
function statusOf(reportId) {
  const review = store.getReview(reportId);
  if (!review) return { state: 'not_run', label: 'Not reviewed' };
  if (store.getSignoff(reportId)) return { state: 'signed_off', label: 'Signed off' };
  const { open } = store.blockingFindings(reportId);
  if (open.length) return { state: 'in_review', label: `${open.length} item${open.length === 1 ? '' : 's'} to clear` };
  return { state: 'ready', label: 'Ready to sign' };
}

app.get('/api/portfolio', (req, res) => {
  const props = store.getProperties().map((p) => {
    const review = store.getReview(p.currentReportId);
    const report = store.getReport(p.currentReportId);
    const s = statusOf(p.currentReportId);
    return {
      id: p.id,
      name: p.name,
      division: p.division,
      currentReportId: p.currentReportId,
      period: report ? report.period : null,
      status: s,
      summary: review ? review.summary : null,
      reviewedAt: review ? review.ranAt : null,
      signoff: store.getSignoff(p.currentReportId),
      sent: store.getSent(p.currentReportId),
      ownerRep: p.ownerRep || null,
    };
  });
  const divisionCounts = store.load().divisionCounts;
  res.json({ divisionCounts, divisionBlurbs: DIVISION_BLURBS, properties: props, llmEnabled: !!process.env.ANTHROPIC_API_KEY });
});

// ── Single report + everything attached to it ──────────
app.get('/api/property/:id', (req, res) => {
  const prop = store.getProperty(req.params.id);
  if (!prop) return res.status(404).json({ error: 'property not found' });
  const report = store.getReport(prop.currentReportId);
  const review = store.getReview(prop.currentReportId);
  res.json({
    property: prop,
    report,
    review,
    dispositions: store.getDispositions(prop.currentReportId),
    signoff: store.getSignoff(prop.currentReportId),
    sent: store.getSent(prop.currentReportId),
    ownerRep: prop.ownerRep || null,
    blocking: review ? store.blockingFindings(prop.currentReportId) : null,
    audit: store.getAuditFor(prop.id),
  });
});

app.get('/api/report/:id', (req, res) => {
  const report = store.getReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'report not found' });
  res.json(report);
});

// ── Run the first-pass review (persisted) ──────────────
app.post('/api/review', (req, res) => {
  const { propertyId } = req.body || {};
  const prop = store.getProperty(propertyId);
  if (!prop) return res.status(404).json({ error: 'property not found' });
  const report = store.getReport(prop.currentReportId);
  if (!report) return res.status(404).json({ error: 'report not found' });
  const prior = report.priorReportId ? store.getReport(report.priorReportId) : null;
  const { by, role } = actor(req);
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

// ── Disposition a finding ──────────────────────────────
app.post('/api/disposition', (req, res) => {
  const { reportId, findingId, action, note } = req.body || {};
  if (!reportId || !findingId || !action) return res.status(400).json({ error: 'reportId, findingId, action required' });
  if (!['accept', 'dismiss', 'resolve'].includes(action)) return res.status(400).json({ error: 'invalid action' });
  if (action === 'dismiss' && !note) return res.status(400).json({ error: 'a note is required to dismiss a finding' });
  const { by, role } = actor(req);
  const d = store.setDisposition(reportId, findingId, { action, note, by, role });
  res.json({ disposition: d, blocking: store.blockingFindings(reportId) });
});

// ── Supervisor sign-off (gated) ────────────────────────
app.post('/api/signoff', (req, res) => {
  const { reportId } = req.body || {};
  const { by, role } = actor(req);
  if (role !== 'Supervisor') return res.status(403).json({ error: 'Only a Supervisor can sign off. Switch role to Supervisor.' });
  const result = store.signOff(reportId, { by, role });
  if (result.error === 'no_review') return res.status(409).json({ error: 'Run the first-pass review before signing off.' });
  if (result.error === 'blocked')
    return res.status(409).json({ error: 'blocked', message: 'Every open exception and second-opinion item must be dispositioned first.', open: result.open.map((f) => ({ id: f.id, title: f.title, tier: f.tier })) });
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

// ── Multi-month trend (leadership: most useful for receivership properties) ──
app.get('/api/trend/:propertyId', (req, res) => {
  const prop = store.getProperty(req.params.propertyId);
  if (!prop) return res.status(404).json({ error: 'property not found' });
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

// ── Calibration + audit ────────────────────────────────
app.get('/api/calibration', (req, res) => res.json(store.calibration()));
app.get('/api/audit', (req, res) => res.json(store.load().audit.slice().reverse()));

// ── Reviewer briefing (Claude if key set, else deterministic) ──
app.post('/api/briefing', async (req, res) => {
  const { propertyId } = req.body || {};
  const prop = store.getProperty(propertyId);
  if (!prop) return res.status(404).json({ error: 'property not found' });
  const review = store.getReview(prop.currentReportId);
  if (!review) return res.status(409).json({ error: 'run the review first' });
  try {
    res.json(await generateBriefing(review));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 4178;
app.listen(PORT, () => {
  console.log(`Farbman first-pass review engine on http://localhost:${PORT}`);
  console.log(`Store: ${store.STORE_PATH}`);
  console.log(`LLM briefing: ${process.env.ANTHROPIC_API_KEY ? 'enabled (Claude)' : 'deterministic fallback'}`);
});
