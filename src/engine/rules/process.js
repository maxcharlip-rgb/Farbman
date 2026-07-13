'use strict';

/**
 * Process / review audit — this is the layer that audits the *review*, not the
 * report. It runs on workflow metadata (who prepared / reviewed / approved, when,
 * and how thoroughly), independent of whether the numbers tie.
 */
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function processRules(report, policy, opts = {}) {
  const out = [];
  const hasOpenProblems = !!opts.hasOpenProblems;

  // 1) Review chain completeness.
  if (!report.reviewedBy) {
    out.push({
      id: 'process.no_reviewer',
      rule: 'process.review_chain',
      title: 'No reviewer recorded on this draft',
      category: 'control',
      resolution: 'rule',
      detectionConfidence: 0.95,
      passed: false,
      severity: 'medium',
      detail: 'The draft has no recorded reviewer. A first-pass tool cannot substitute for the review step — assign a reviewer before sign-off.',
      evidence: ['reviewedBy = null'],
    });
  } else if (policy.requireFullReview && report.reviewedBy.scope && report.reviewedBy.scope !== 'full') {
    out.push({
      id: 'process.partial_review',
      rule: 'process.review_chain',
      title: `Reviewer covered only the ${report.reviewedBy.scope.replace(/_/g, ' ')}`,
      category: 'control',
      resolution: 'rule',
      detectionConfidence: 0.92,
      passed: false,
      severity: 'medium',
      detail:
        `Policy requires a full-report review, but ${report.reviewedBy.name} (${report.reviewedBy.role}) is ` +
        `recorded as reviewing only the ${report.reviewedBy.scope.replace(/_/g, ' ')}. Confirm the full ` +
        'statement was reviewed, not just the narrative.',
      evidence: [`reviewedBy.scope = ${report.reviewedBy.scope}`, 'policy.requireFullReview = true'],
    });
  } else {
    out.push({
      id: 'process.review_scope_ok',
      rule: 'process.review_chain',
      title: 'Reviewer scope meets policy (full review)',
      category: 'control',
      resolution: 'rule',
      detectionConfidence: 0.92,
      passed: true,
      severity: 'info',
      detail: `${report.reviewedBy.name} is recorded as reviewing the full report.`,
      evidence: [`reviewedBy.scope = ${report.reviewedBy.scope}`],
    });
  }

  // 2) Supervisor sign-off status (informational at draft stage).
  if (!report.approvedBy) {
    out.push({
      id: 'process.awaiting_signoff',
      rule: 'process.signoff',
      title: 'Awaiting supervisor sign-off',
      category: 'control',
      resolution: 'rule',
      detectionConfidence: 0.99,
      passed: true,
      severity: 'info',
      detail: 'No supervisor approval is recorded yet — expected for a draft. This tool runs before that sign-off and never replaces it.',
      evidence: [`status = ${report.status}`],
    });
  }

  // 3) Segregation of duties.
  const roles = [
    ['preparer', report.preparedBy && report.preparedBy.name],
    ['reviewer', report.reviewedBy && report.reviewedBy.name],
    ['approver', report.approvedBy && report.approvedBy.name],
  ].filter(([, n]) => n);
  const byName = {};
  for (const [role, name] of roles) (byName[name] = byName[name] || []).push(role);
  const overlaps = Object.entries(byName).filter(([, rs]) => rs.length > 1);
  if (overlaps.length) {
    out.push({
      id: 'process.sod',
      rule: 'process.segregation',
      title: 'Segregation-of-duties conflict — one person holds multiple roles',
      category: 'control',
      resolution: 'rule',
      detectionConfidence: 0.92,
      passed: false,
      severity: 'high',
      detail: overlaps.map(([name, rs]) => `${name} appears as ${rs.join(' + ')}`).join('; ') + '.',
      evidence: overlaps.map(([name, rs]) => `${name}: ${rs.join(', ')}`),
    });
  } else if (roles.length >= 2) {
    out.push({
      id: 'process.sod_ok',
      rule: 'process.segregation',
      title: 'Segregation of duties intact',
      category: 'control',
      resolution: 'rule',
      detectionConfidence: 0.9,
      passed: true,
      severity: 'info',
      detail: 'Preparer, reviewer and approver are distinct people (where recorded).',
      evidence: roles.map(([r, n]) => `${r} = ${n}`),
    });
  }

  // 4) Review timeliness.
  if (report.reviewedDate && report.periodClose) {
    const days = daysBetween(report.periodClose, report.reviewedDate);
    if (days > policy.maxDaysCloseToReview) {
      out.push({
        id: 'process.timeliness',
        rule: 'process.timeliness',
        title: `Reviewed ${days} days after period close (policy: ${policy.maxDaysCloseToReview})`,
        category: 'control',
        resolution: 'rule',
        detectionConfidence: 0.9,
        passed: false,
        severity: 'low',
        detail: `Review on ${report.reviewedDate} is ${days} days after the ${report.periodClose} close, beyond the ${policy.maxDaysCloseToReview}-day target.`,
        evidence: [`periodClose = ${report.periodClose}`, `reviewedDate = ${report.reviewedDate}`, `days = ${days}`],
      });
    }
  }

  // 5) Possible rubber-stamp: fast review while open exceptions exist.
  if (report.reviewDurationMinutes != null && report.reviewDurationMinutes < policy.minReviewMinutes && hasOpenProblems) {
    out.push({
      id: 'process.rubber_stamp',
      rule: 'process.rubber_stamp',
      title: `Review logged at ${report.reviewDurationMinutes} min with open exceptions present`,
      category: 'control',
      resolution: 'judgment',
      detectionConfidence: 0.6,
      severity: 'medium',
      escalateReason: 'Whether a fast review was thorough is a judgment about a person — not the tool\'s call.',
      detail:
        `The recorded review took ${report.reviewDurationMinutes} minutes while this draft still carries ` +
        'open content exceptions. That may be perfectly fine, but the pattern is worth a second look to ' +
        'confirm the review was substantive.',
      evidence: [`reviewDurationMinutes = ${report.reviewDurationMinutes}`, `minReviewMinutes = ${policy.minReviewMinutes}`],
    });
  }

  return out;
}

module.exports = { processRules };
