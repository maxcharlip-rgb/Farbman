'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { runReview } = require('../src/engine');
const { REPORTS } = require('../src/data/reports');

test('runReview produces a tiered summary on a seed fixture without throwing', () => {
  const report = Object.values(REPORTS)[0];
  const review = runReview(report, null);
  assert.ok(Array.isArray(review.findings) && review.findings.length > 0);
  assert.ok(review.summary && review.summary.counts);
  assert.strictEqual(typeof review.summary.headline, 'string');
  for (const f of review.findings) assert.ok(['assert', 'flag', 'escalate'].includes(f.tier));
});

test('a report missing its financial sections still reviews cleanly instead of throwing (500)', () => {
  const broken = { id: 'x', propertyId: 'x', property: 'X', division: 'X', period: { label: 'm', month: '2026-04' } };
  let review;
  assert.doesNotThrow(() => { review = runReview(broken, null); }); // the rule guards must absorb it
  assert.ok(Array.isArray(review.findings) && review.findings.length > 0);
  assert.ok(typeof review.summary.headline === 'string');
});

test('a rule that throws is caught by the guard and surfaces as an engine.error finding', () => {
  // incomeStatement as a non-object forces a rule to throw when it reads .revenue.reduce
  const trap = { id: 'y', propertyId: 'y', property: 'Y', division: 'Y', period: { label: 'm', month: '2026-04' }, incomeStatement: 42 };
  let review;
  assert.doesNotThrow(() => { review = runReview(trap, null); });
  assert.ok(review.findings.some((f) => f.rule === 'engine.error'), 'a throwing rule should become an engine.error finding, not a crash');
});
