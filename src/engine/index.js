'use strict';

const { DEFAULT_POLICY } = require('./policy');
const { enrich, TIERS } = require('./confidence');
const { arithmeticRules } = require('./rules/arithmetic');
const { bankRecRules } = require('./rules/bankrec');
const { consistencyRules } = require('./rules/consistency');
const { crossrefRules } = require('./rules/crossref');
const { monthOverMonthRules, isProblem } = require('./rules/monthOverMonth');
const { processRules } = require('./rules/process');
const { narrativeQualityRules, narrativeContinuityRules } = require('./rules/narrative');
const { redactionRules } = require('./rules/redaction');

/** Content rules describe the report itself; run on both current and prior periods. */
function contentRules(report, policy, prior = null) {
  const out = [];
  const guard = (fn) => {
    try {
      out.push(...(fn() || []));
    } catch (e) {
      out.push({
        id: 'engine.error',
        rule: 'engine.error',
        title: 'A rule failed to run on this report',
        category: 'engine',
        resolution: 'judgment',
        detectionConfidence: 0,
        autoEscalate: true,
        severity: 'medium',
        detail: `Rule error: ${e.message}. The engine flags rather than silently skips — review this section manually.`,
        evidence: [String(e.stack || e)],
      });
    }
  };
  guard(() => arithmeticRules(report, policy));
  guard(() => bankRecRules(report));
  guard(() => consistencyRules(report, policy, prior));
  guard(() => crossrefRules(report));
  guard(() => narrativeQualityRules(report, policy));
  guard(() => redactionRules(report, policy));
  return out;
}

/**
 * Run a full first-pass review.
 * @param {object} report current draft report
 * @param {object|null} prior prior-period report (or null if none on file)
 * @param {object} policyOverrides optional policy overrides
 */
function runReview(report, prior, policyOverrides = {}) {
  const policy = { ...DEFAULT_POLICY, ...policyOverrides };

  const currentContent = contentRules(report, policy, prior);
  const hasOpenProblems = currentContent.some(isProblem);

  let mom = [];
  if (prior) {
    const priorContent = contentRules(prior, policy);
    mom = monthOverMonthRules(report, prior, currentContent, priorContent, policy);
    // Narrative continuity — stale carry-overs and reverted (lost-revision) notes.
    mom.push(...narrativeContinuityRules(report, prior, policy));
  } else {
    mom = [
      {
        id: 'mom.no_baseline',
        rule: 'mom.no_baseline',
        title: 'No prior-period report on file — month-over-month checks skipped',
        category: 'control',
        resolution: 'rule',
        detectionConfidence: 0.95,
        autoEscalate: true,
        escalateReason: 'First reporting period: the engine has no baseline to calibrate against.',
        severity: 'medium',
        detail:
          'This appears to be a first reporting period for this property. The engine is calibrated against ' +
          'the prior month and the standard template; with no baseline, continuity and recurring-issue ' +
          'checks cannot run. First-period reports warrant extra scrutiny — treat the automated coverage ' +
          'here as partial.',
        evidence: ['priorReportId = null'],
      },
    ];
  }

  const proc = processRules(report, policy, { hasOpenProblems });

  const raw = [...currentContent, ...mom, ...proc];
  const findings = raw.map((f) => enrich(f, policy));

  return {
    property: meta(report),
    summary: summarize(findings, { hasPrior: !!prior, policy }),
    findings,
    policy,
    generatedAt: new Date().toISOString(),
  };
}

function meta(report) {
  return {
    id: report.id,
    propertyId: report.propertyId,
    property: report.property,
    division: report.division,
    period: report.period,
    status: report.status,
    preparedBy: report.preparedBy,
    reviewedBy: report.reviewedBy,
    approvedBy: report.approvedBy,
  };
}

function summarize(findings, { hasPrior, policy }) {
  const counts = { assert: 0, flag: 0, escalate: 0 };
  const byCategory = { content: 0, control: 0, engine: 0 };
  let verified = 0; // deterministic checks that passed
  let exceptions = 0; // deterministic checks the tool is sure failed
  let problems = 0; // anything that isn't a clean pass
  for (const f of findings) {
    counts[f.tier] = (counts[f.tier] || 0) + 1;
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    if (f.passed === true) verified += 1;
    if (f.tier === 'assert' && f.passed === false) exceptions += 1;
    if (f.passed === false || (f.passed === null && f.severity !== 'info')) problems += 1;
  }
  const secondOpinionCount = counts.escalate;

  const parts = [];
  parts.push(`${verified} auto-verified`);
  if (exceptions) parts.push(`${exceptions} deterministic exception${exceptions === 1 ? '' : 's'}`);
  parts.push(`${counts.flag} to confirm`);
  parts.push(`${secondOpinionCount} needing a second opinion`);

  return {
    counts,
    byCategory,
    verified,
    exceptions,
    problems,
    secondOpinionCount,
    hasPrior,
    // Deliberately advisory wording — never a pass/fail verdict.
    headline: `First-pass complete: ${parts.join(', ')}.`,
    disclaimer:
      'This is an assistant pass, not an approval. It flags material items before the human reviewer ' +
      'and gets out of the way. It does not sign off, does not replace the supervisor review, and does ' +
      'not judge whether a flagged item is actually a problem.',
    tiers: TIERS,
  };
}

module.exports = { runReview, contentRules };
