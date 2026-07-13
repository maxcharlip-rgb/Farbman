'use strict';

const { money, sum } = require('../util');

/**
 * Deterministic footing / tie-out checks. These are the engine's highest-confidence
 * work: it can compute the answer itself, so a pass is asserted and a break is a
 * high-severity assert (the reviewer won't dispute that the numbers don't add up).
 */
function arithmeticRules(report, policy) {
  const out = [];
  const tol = policy.footTolerance;
  const is = report.incomeStatement;

  const foot = (id, title, computed, stated, what) => {
    const diff = Math.round((computed - stated) * 100) / 100;
    const passed = Math.abs(diff) <= tol;
    return {
      id,
      rule: id,
      title: passed ? title : `${title} — does not tie`,
      category: 'content',
      resolution: 'arithmetic',
      detectionConfidence: 0.99,
      passed,
      severity: passed ? 'info' : 'high',
      detail: passed
        ? `Computed ${money(computed)} from ${what}; matches the stated ${money(stated)}.`
        : `Computed ${money(computed)} from ${what}, but the report states ${money(stated)} — a difference of ${money(Math.abs(diff))}.`,
      evidence: [`computed = ${computed.toFixed(2)}`, `stated = ${stated.toFixed(2)}`, `tolerance = ${tol}`],
    };
  };

  if (is) {
    out.push(foot('arith.revenue', 'Total Revenue foots', sum(is.revenue, 'amount'), is.totalRevenue, 'the revenue line items'));
    out.push(foot('arith.expenses', 'Total Expenses foots', sum(is.expenses, 'amount'), is.totalExpenses, 'the expense line items'));
    out.push(foot('arith.noi', 'Net Operating Income ties', is.totalRevenue - is.totalExpenses, is.noiPTD, 'Total Revenue − Total Expenses'));
  }

  const b = report.balance;
  if (b) {
    out.push(foot('arith.cash', 'Ending cash ties', b.beginningCash + b.netCashFlow, b.endingCash, 'Beginning Cash + Net Cash Flow'));
  }

  const ar = report.receivablesAging;
  if (ar) {
    const computed = (ar.current || 0) + (ar.d0_30 || 0) + (ar.d30_60 || 0) + (ar.d60_90 || 0) + (ar.d90_plus || 0);
    out.push(foot('arith.ar', 'Receivables aging foots', computed, ar.total, 'the aging buckets'));
  }

  return out;
}

module.exports = { arithmeticRules };
