'use strict';

const { money } = require('../util');

/**
 * Cross-reference checks — the engine surfaces a *coincidence* between two parts of
 * the report but explicitly refuses to conclude what it means. Classic second-opinion
 * territory: medium detection, judgment to resolve.
 */
function crossrefRules(report) {
  const out = [];
  const is = report.incomeStatement;
  const ar = report.receivablesAging;
  if (!is) return out;

  for (const line of is.revenue) {
    if (line.amount >= 0) continue;

    const magnitude = Math.abs(line.amount);
    const arBuckets = ar
      ? [
          ['Current', ar.current],
          ['0–30 days', ar.d0_30],
          ['30–60 days', ar.d30_60],
          ['60–90 days', ar.d60_90],
          ['90+ days', ar.d90_plus],
        ]
      : [];
    const match = arBuckets.find(([, v]) => Math.abs((v || 0) - magnitude) <= 0.01);

    if (match) {
      out.push({
        id: `crossref.neg_rev.${line.label.replace(/\W+/g, '_')}`,
        rule: 'crossref.neg_rev_vs_ar',
        title: `Negative ${line.label} (${money(line.amount)}) matches a ${money(magnitude)} receivable`,
        category: 'content',
        resolution: 'judgment',
        detectionConfidence: 0.6,
        severity: 'medium',
        escalateReason: 'Reversal vs. contra vs. misposting can only be settled with source docs + judgment.',
        detail:
          `${line.label} is booked at ${money(line.amount)} (a credit/reversal), and the receivables ` +
          `aging shows a ${money(magnitude)} balance in "${match[0]}". The amounts tie, which is worth a ` +
          'look — this could be a billing reversal, a contra entry, or a misposting. The engine flags the ' +
          'coincidence; it does not conclude which one it is.',
        evidence: [`revenue line = ${line.amount}`, `${match[0]} A/R = ${match[1]}`],
      });
    } else {
      out.push({
        id: `crossref.neg_rev_only.${line.label.replace(/\W+/g, '_')}`,
        rule: 'crossref.neg_rev',
        title: `Negative revenue line: ${line.label} (${money(line.amount)})`,
        category: 'content',
        resolution: 'judgment',
        detectionConfidence: 0.62,
        severity: 'low',
        escalateReason: 'A credit balance in revenue needs a human to confirm the reason.',
        detail:
          `${line.label} is reported as a negative amount (${money(line.amount)}). A credit in a revenue ` +
          'line is usually a reversal or adjustment — confirm the supporting entry.',
        evidence: [`revenue line = ${line.amount}`],
      });
    }
  }

  return out;
}

module.exports = { crossrefRules };
