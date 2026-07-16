'use strict';

// Isolate the store on a temp dir BEFORE requiring it (paths are read from env at load).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'farbman-store-'));
process.env.DATA_DIR = tmp;
process.env.STORE_PATH = path.join(tmp, 'store.json');

const { test, after } = require('node:test');
const assert = require('node:assert');
const store = require('../src/store');
const { runReview } = require('../src/engine');

function seedReview(reportId) {
  const report = store.getReport(reportId);
  const prior = report.priorReportId ? store.getReport(report.priorReportId) : null;
  const review = runReview(report, prior);
  store.saveReview(reportId, review, 'Tester', 'Reviewer');
  return review;
}
const someReportId = () => store.getProperties().find((p) => p.currentReportId).currentReportId;

test("a role's disposition is a private draft until submitted, then publishes", () => {
  const rid = someReportId();
  const review = seedReview(rid);
  const fid = review.findings.find((f) => f.passed === false || f.tier === 'escalate').id;

  store.setDisposition(rid, fid, { action: 'accept', note: 'ok', by: 'R', role: 'Reviewer' });
  assert.ok(store.dispositionsView(rid, 'Reviewer').mine[fid], 'author should see their own draft');
  assert.ok(!store.dispositionsView(rid, 'Supervisor').others[fid], 'unsubmitted draft must be hidden from the Supervisor');

  store.submitReview(rid, { by: 'R', role: 'Reviewer' });
  const supView = store.dispositionsView(rid, 'Supervisor');
  assert.ok(supView.others[fid] && supView.others[fid].some((o) => o.role === 'Reviewer'), 'submitted pass should publish to the team');
});

test('sign-off is blocked until the supervisor clears their OWN blocking items', () => {
  const rid = someReportId();
  seedReview(rid);
  const blocked = store.signOff(rid, { by: 'S', role: 'Supervisor' });
  assert.strictEqual(blocked.error, 'blocked');
  for (const f of store.blockingFindings(rid, 'Supervisor').open) {
    store.setDisposition(rid, f.id, { action: 'accept', note: 'ok', by: 'S', role: 'Supervisor' });
  }
  const ok = store.signOff(rid, { by: 'S', role: 'Supervisor' });
  assert.ok(ok.at, 'sign-off should succeed once the supervisor pass is clear');
});

test('upsertReport rejects a malformed report before mutating the store', () => {
  const before = store.getProperties().length;
  assert.throws(() => store.upsertReport({ property: 'No IDs' }, 'T', 'Accountant'));
  assert.strictEqual(store.getProperties().length, before, 'no junk property should have been created');
});

test('syncProperties refuses a truncated list that would wipe most of the roster', () => {
  const five = ['A', 'B', 'C', 'D', 'E'].map((c) => ({ code: 'CODE' + c, name: 'Prop ' + c }));
  store.syncProperties(five, { by: 'T', role: 'Accountant' }); // establish 5+ coded active properties
  assert.throws(() => store.syncProperties([{ code: 'CODEA', name: 'Prop A' }], { by: 'T', role: 'Accountant' }));
});

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

test('re-running the first-pass review invalidates a prior sign-off', () => {
  const rid = someReportId();
  const review = seedReview(rid);
  for (const f of store.blockingFindings(rid, 'Supervisor').open) {
    store.setDisposition(rid, f.id, { action: 'accept', note: 'ok', by: 'S', role: 'Supervisor' });
  }
  store.signOff(rid, { by: 'S', role: 'Supervisor' });
  assert.ok(store.getSignoff(rid), 'signed off');
  store.saveReview(rid, review, 'Tester', 'Reviewer'); // re-run
  assert.strictEqual(store.getSignoff(rid), null, 're-run must clear the stale sign-off');
});
