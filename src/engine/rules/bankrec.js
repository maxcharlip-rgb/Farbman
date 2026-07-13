'use strict';

const { fmtRanges } = require('../util');

/**
 * Bank reconciliation / cash-control checks.
 *  - Missing bank-rec section → the engine cannot verify; says so (does not stay silent).
 *  - Check-sequence gap → high-confidence, rule-based control exception (asserted).
 */
function bankRecRules(report) {
  const out = [];
  const b = report.bankRec;

  if (!b || !b.checkSequence) {
    out.push({
      id: 'bankrec.missing',
      rule: 'bankrec.missing',
      title: 'Bank reconciliation section not found — check disposition could not be verified',
      category: 'content',
      resolution: 'rule',
      detectionConfidence: 0.92,
      passed: false,
      severity: 'medium',
      detail:
        'No bank reconciliation / check listing was present in this draft, so the engine could not ' +
        'confirm that issued checks are accounted for. Silence is not a pass — attach the bank ' +
        'reconciliation before sign-off.',
      evidence: ['bankRec section: absent'],
    });
    return out;
  }

  const { issued = [], cleared = [], outstanding = [] } = b.checkSequence;
  const accounted = new Set([...cleared, ...outstanding]);
  const missing = issued.filter((c) => !accounted.has(c));

  if (missing.length === 0) {
    out.push({
      id: 'bankrec.checks',
      rule: 'bankrec.checks',
      title: 'All issued checks accounted for',
      category: 'content',
      resolution: 'rule',
      detectionConfidence: 0.97,
      passed: true,
      severity: 'info',
      detail: 'Every issued check number appears in either the cleared or the outstanding list.',
      evidence: [`issued = ${issued.length}`, `cleared = ${cleared.length}`, `outstanding = ${outstanding.length}`],
    });
  } else {
    out.push({
      id: 'bankrec.checks',
      rule: 'bankrec.checks',
      title: `Check sequence gap: ${fmtRanges(missing)} in neither cleared nor outstanding list`,
      category: 'content',
      resolution: 'rule',
      detectionConfidence: 0.97,
      passed: false,
      severity: 'high',
      detail:
        `Issued check(s) ${fmtRanges(missing)} do not appear in the cleared check listing or the ` +
        'outstanding check list. A gap in the check sequence with no disposition is a cash-control ' +
        'exception that should be resolved against the bank reconciliation before sign-off.',
      evidence: [
        `issued = ${issued.join(', ')}`,
        `cleared = ${cleared.join(', ') || '(none)'}`,
        `outstanding = ${outstanding.join(', ') || '(none)'}`,
        `unaccounted = ${fmtRanges(missing)}`,
      ],
    });
  }

  return out;
}

module.exports = { bankRecRules };
