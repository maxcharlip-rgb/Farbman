'use strict';

// Known-answer tests: the seed reports contain DELIBERATELY planted errors.
// "How do we know the reviews are correct?" — because the engine must catch
// every planted error, verify the genuinely-correct arithmetic, and stay
// quiet on a clean report. If a rule change breaks any of that, this fails.

const { test } = require('node:test');
const assert = require('node:assert');
const { runReview } = require('../src/engine');
const { REPORTS } = require('../src/data/reports');

const fixture = REPORTS['grand-river-42350-2026-06'];
const prior = REPORTS[fixture.priorReportId];
const review = runReview(fixture, prior);
const failed = (rule) => review.findings.some((f) => f.rule === rule && f.passed === false);

test('every planted error in the seed report is caught as a failure', () => {
  // Each of these corresponds to an error deliberately planted in the fixture.
  assert.ok(failed('bankrec.checks'), 'check-sequence gap (10062–10064 unaccounted)');
  assert.ok(failed('redaction.accounts'), 'unredacted account number in a public-record report');
  assert.ok(failed('narrative.reverted'), 'narrative reverted to pre-revision text (lost edits)');
  assert.ok(failed('process.review_chain'), 'reviewer covered only the exec summary');
  assert.ok(failed('process.timeliness'), 'reviewed after the policy deadline');
});

test('the correct arithmetic is auto-verified, not flagged', () => {
  const verified = review.findings.filter((f) => f.passed === true).map((f) => f.rule);
  assert.ok(verified.some((r) => r.startsWith('arith.')), 'foots/tie-outs verified');
  assert.ok(review.summary.verified >= 8, `expected a healthy verified count, got ${review.summary.verified}`);
});

test('judgment calls escalate to a person instead of being auto-decided', () => {
  const esc = review.findings.filter((f) => f.tier === 'escalate').map((f) => f.rule);
  assert.ok(esc.includes('consistency.round_accrual'), 'round-number accrual needs human judgment');
});

function cleanReport() {
  // A genuinely complete, correct report: foots, ties, reconciled checks,
  // required narrative sections, and a full review chain.
  return {
    id: 'clean-1', propertyId: 'clean', property: 'Clean Test Property', division: '3rd Party',
    period: { label: 'June 2026', month: '2026-06', type: 'PTD' },
    status: 'draft_pending_signoff',
    preparedBy: { name: 'A. Accountant', role: 'Property Accountant' },
    reviewedBy: { name: 'L. Reviewer', role: 'Property Manager', scope: 'full' },
    incomeStatement: {
      revenue: [{ label: 'Base Rent', amount: 1000 }],
      totalRevenue: 1000,
      expenses: [{ label: 'Utilities', amount: 400 }],
      totalExpenses: 400,
      noiPTD: 600,
    },
    balance: { beginningCash: 100, netCashFlow: 600, endingCash: 700 },
    bankRec: { checkSequence: { issued: [100, 101], cleared: [100, 101], outstanding: [] }, note: 'All checks cleared.' },
    narrative: {
      budgetVariance: { title: 'Budget Variance Notes', text: 'Utilities ran slightly under budget this period.' },
      arNotes: { title: 'AR Notes', text: 'No outstanding receivables at period end.' },
    },
  };
}

test('a clean report produces zero deterministic exceptions', () => {
  const r = runReview(cleanReport(), null);
  assert.strictEqual(r.summary.exceptions, 0, 'no false exceptions on a correct report');
});

test('corrupting a total is caught as a deterministic exception', () => {
  const bad = cleanReport();
  bad.incomeStatement.totalRevenue = 1500; // does not foot (lines sum to 1000)
  const r = runReview(bad, null);
  assert.ok(r.summary.exceptions >= 1, 'a wrong total must be flagged as an exception');
  assert.ok(r.findings.some((f) => f.rule.startsWith('arith.') && f.passed === false));
});
