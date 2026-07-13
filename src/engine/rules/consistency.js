'use strict';

const { money } = require('../util');

/**
 * Internal-consistency and "is this an estimate?" checks. These are where the
 * two-axis model earns its keep: the engine is fairly sure it sees *something*,
 * but resolving it needs either a source document or a human's judgment, so it
 * flags or escalates rather than asserting.
 */
function consistencyRules(report, policy, prior) {
  const out = [];
  const is = report.incomeStatement;
  const es = report.execSummary || {};

  // 1) Cumulative YTD continuity. Reports are cumulative within the year, so an
  //    error in a prior month propagates until caught (leadership's exact concern).
  //    With the prior report on file the roll-forward is pure arithmetic:
  //    YTD(this month) must equal YTD(last month) + this period's NOI.
  if (report.period && report.period.type === 'PTD' && es.ytdNOI !== null && es.ytdNOI !== undefined && is) {
    const priorYtd = prior && prior.execSummary ? prior.execSummary.ytdNOI : null;
    if (priorYtd !== null && priorYtd !== undefined) {
      const expected = Math.round((priorYtd + is.noiPTD) * 100) / 100;
      const diff = Math.round((es.ytdNOI - expected) * 100) / 100;
      const passed = Math.abs(diff) <= policy.footTolerance;
      out.push({
        id: 'consistency.ytd_continuity',
        rule: 'consistency.ytd_continuity',
        title: passed
          ? 'Cumulative YTD NOI rolls forward from prior month'
          : 'Cumulative YTD NOI does not roll forward from prior month',
        category: 'content',
        resolution: 'arithmetic',
        detectionConfidence: 0.97,
        passed,
        severity: passed ? 'info' : 'high',
        detail: passed
          ? `Prior YTD ${money(priorYtd)} + this period's NOI ${money(is.noiPTD)} = ${money(expected)}, matching the stated YTD ${money(es.ytdNOI)}. ` +
            'Note: this verifies continuity only — if a prior month was wrong, the error still carries; see the trend view.'
          : `Prior YTD ${money(priorYtd)} + this period's NOI ${money(is.noiPTD)} = ${money(expected)}, but the executive summary states ${money(es.ytdNOI)} — a ${money(Math.abs(diff))} break. ` +
            'Because reporting is cumulative, a break like this propagates into every later month until corrected.',
        evidence: [`prior ytdNOI = ${priorYtd}`, `noiPTD = ${is.noiPTD}`, `expected = ${expected}`, `stated = ${es.ytdNOI}`],
      });
    } else {
      out.push({
        id: 'consistency.ytd_vs_ptd',
        rule: 'consistency.ytd_vs_ptd',
        title: 'Executive summary cites a year-to-date NOI the period statement does not show',
        category: 'content',
        resolution: 'source_docs',
        detectionConfidence: 0.9,
        severity: 'medium',
        detail:
          `The executive summary states YTD NOI of ${money(es.ytdNOI)}, but the income statement is a ` +
          `single-period (${report.period.label}) statement showing period NOI of ${money(is.noiPTD)}, ` +
          'and no prior-period YTD is on file to roll forward from. Confirm against the year-to-date schedule.',
        evidence: [`exec ytdNOI = ${es.ytdNOI}`, `statement noiPTD = ${is.noiPTD}`, `prior YTD = (none on file)`],
      });
    }
  }

  // 2) Round-number expense → likely accrual/estimate. Judgment to resolve.
  if (is) {
    const biggestExpense = Math.max(...is.expenses.map((e) => e.amount));
    for (const e of is.expenses) {
      const isRound = e.amount >= policy.roundNumberFloor && e.amount % policy.roundStep === 0;
      if (!isRound) continue;
      const dominatesVariance =
        es.monthExpenseVarianceToBudget && e.amount >= 0.6 * Math.abs(es.monthExpenseVarianceToBudget);
      out.push({
        id: `consistency.round.${e.label.replace(/\W+/g, '_')}`,
        rule: 'consistency.round_accrual',
        title: `${e.label} is an exact round number (${money(e.amount)}) — likely an accrual/estimate`,
        category: 'content',
        resolution: 'judgment',
        detectionConfidence: 0.78,
        severity: e.amount === biggestExpense ? 'medium' : 'low',
        escalateReason: 'Accrual vs. actual is a judgment call against the GL.',
        detail:
          `${e.label} of ${money(e.amount)} is an exact multiple of ${money(policy.roundStep)}, which ` +
          'usually signals an estimate or accrual rather than a booked actual. ' +
          (dominatesVariance
            ? 'It also accounts for most of the period expense variance to budget, so it materially drives the reported result. '
            : '') +
          'Confirm accrual vs. actual against the general ledger / accrual schedule.',
        evidence: [`amount = ${e.amount}`, `roundStep = ${policy.roundStep}`, `largestExpense = ${biggestExpense}`],
      });
    }
  }

  // 3) Net cash flow vs. period NOI gap → wants a cash reconciliation.
  if (is && report.balance) {
    const gap = Math.abs(report.balance.netCashFlow - is.noiPTD);
    if (gap > policy.cashVsNoiGap) {
      out.push({
        id: 'consistency.cash_vs_noi',
        rule: 'consistency.cash_vs_noi',
        title: 'Net cash flow differs materially from period NOI',
        category: 'content',
        resolution: 'source_docs',
        detectionConfidence: 0.82,
        severity: 'low',
        detail:
          `Period NOI is ${money(is.noiPTD)} but net cash flow is ${money(report.balance.netCashFlow)} ` +
          `(a ${money(gap)} difference). That can be entirely legitimate — accruals, A/R and A/P timing, ` +
          'non-operating items — but the reconciliation should be on file to support it.',
        evidence: [`noiPTD = ${is.noiPTD}`, `netCashFlow = ${report.balance.netCashFlow}`, `gap = ${gap.toFixed(2)}`],
      });
    }
  }

  // 4) Going-concern / disposition language → out of scope for a numbers pass.
  const narrative = (es.narrative || '').toLowerCase();
  if (/(listed for sale|for sale|disposition|receiver|foreclos)/.test(narrative)) {
    out.push({
      id: 'consistency.going_concern',
      rule: 'consistency.going_concern',
      title: 'Disposition / receivership context noted — out of scope for a first-pass numbers review',
      category: 'content',
      resolution: 'expertise',
      detectionConfidence: 0.7,
      severity: 'info',
      escalateReason: 'Going-concern, valuation, and disclosure are specialist/counsel calls.',
      detail:
        'The summary references sale/disposition or receivership status. Any going-concern, valuation, ' +
        'or disclosure implications are deliberately left to the supervisor / counsel — the engine does ' +
        'not opine on them.',
      evidence: [`narrative excerpt: "${(es.narrative || '').slice(0, 120)}"`],
    });
  }

  return out;
}

module.exports = { consistencyRules };
