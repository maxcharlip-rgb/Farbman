'use strict';

const { money } = require('../util');

/** A raw content finding counts as an open "problem" if it isn't a clean pass. */
function isProblem(f) {
  if (f.passed === true) return false;
  if (f.passed === false) return true;
  return ['low', 'medium', 'high'].includes(f.severity);
}

/**
 * Month-over-month checks. Requires the prior period's report and its content
 * findings (computed by the orchestrator).
 *  - cash continuity: this month's beginning cash must equal last month's ending cash.
 *  - recurring issue: a problem that also appeared last period is a *process* signal.
 *  - large line-item swings worth a look.
 */
function monthOverMonthRules(report, prior, currentContent, priorContent, policy) {
  const out = [];

  // 1) Cash continuity (deterministic, high confidence).
  if (prior.balance && report.balance) {
    const diff = Math.round((report.balance.beginningCash - prior.balance.endingCash) * 100) / 100;
    const passed = Math.abs(diff) <= policy.footTolerance;
    out.push({
      id: 'mom.cash_continuity',
      rule: 'mom.cash_continuity',
      title: passed ? 'Cash rolls forward from prior period' : 'Cash does not roll forward from prior period',
      category: 'content',
      resolution: 'rule',
      detectionConfidence: 0.95,
      passed,
      severity: passed ? 'info' : 'high',
      detail: passed
        ? `Beginning cash ${money(report.balance.beginningCash)} matches prior-period ending cash ${money(prior.balance.endingCash)}.`
        : `Beginning cash ${money(report.balance.beginningCash)} does not match prior-period ending cash ${money(prior.balance.endingCash)} — a ${money(Math.abs(diff))} break in continuity.`,
      evidence: [`beginning = ${report.balance.beginningCash}`, `prior ending = ${prior.balance.endingCash}`],
    });
  }

  // 2) Recurring problems (process signal → auto-escalate).
  const priorProblemIds = new Set(priorContent.filter(isProblem).map((f) => f.id));
  for (const cf of currentContent.filter(isProblem)) {
    if (!priorProblemIds.has(cf.id)) continue;
    out.push({
      id: `mom.recurring.${cf.id}`,
      rule: 'mom.recurring',
      title: `Recurring item: "${cf.title}" was also present last period`,
      category: 'control',
      resolution: 'rule',
      detectionConfidence: 0.9,
      autoEscalate: true,
      escalateReason: 'A finding that survives across reviews is a process question, not just a content one.',
      severity: 'medium',
      detail:
        'This item appeared in the prior period as well, which was signed off. A finding that persists ' +
        'across reviews should be a conscious, documented decision — confirm it was not simply carried ' +
        'forward unaddressed.',
      evidence: [`current: ${cf.title}`, `prior report: ${prior.id}`],
    });
  }

  // 3) Large line-item swings.
  const lineMap = (items) => Object.fromEntries(items.map((i) => [i.label, i.amount]));
  const curr = { ...lineMap(report.incomeStatement.revenue), ...lineMap(report.incomeStatement.expenses) };
  const last = { ...lineMap(prior.incomeStatement.revenue), ...lineMap(prior.incomeStatement.expenses) };
  for (const label of Object.keys(curr)) {
    if (!(label in last)) continue;
    const a = curr[label];
    const b = last[label];
    const absDelta = Math.abs(a - b);
    const pct = b !== 0 ? absDelta / Math.abs(b) : 1;
    if (absDelta >= policy.momSwingAbs && pct >= policy.momSwingPct) {
      out.push({
        id: `mom.swing.${label.replace(/\W+/g, '_')}`,
        rule: 'mom.swing',
        title: `${label} moved ${money(absDelta)} (${Math.round(pct * 100)}%) vs. last period`,
        category: 'content',
        resolution: 'source_docs',
        detectionConfidence: 0.8,
        severity: 'low',
        detail: `${label} is ${money(a)} this period vs. ${money(b)} last period. Large swings are worth a quick look for a supporting reason.`,
        evidence: [`current = ${a}`, `prior = ${b}`],
      });
    }
  }

  return out;
}

module.exports = { monthOverMonthRules, isProblem };
