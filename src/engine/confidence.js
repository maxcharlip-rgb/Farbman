'use strict';

const { DEFAULT_POLICY } = require('./policy');

/**
 * The two-axis model that decides how a finding is presented.
 *
 *   Axis 1 — detectionConfidence (0..1): how sure the engine is that there is
 *            something here at all.
 *   Axis 2 — resolution: how the item gets *resolved*. Some answers are objective
 *            (arithmetic / a rule / pulling a source document); others genuinely
 *            require a human's judgment or domain expertise.
 *
 * The tier (assert / flag / escalate) is derived from those two axes plus any
 * explicit auto-escalate trigger. "escalate" === "second opinion required".
 *
 * Key design choice: the tool gets *more* cautious as it gets less certain. It
 * only ASSERTS when it is both highly confident AND the matter is deterministic.
 * Anything needing human judgment escalates no matter how confident the detection.
 */
const RESOLUTION = {
  arithmetic: { label: 'Arithmetic', needsJudgment: false, note: 'Footing / tie-out the tool can compute itself.' },
  rule: { label: 'Rule-based', needsJudgment: false, note: 'A deterministic policy rule (e.g. sequence continuity).' },
  source_docs: { label: 'Needs source docs', needsJudgment: false, note: 'Objective answer, but the reviewer must pull a supporting document.' },
  judgment: { label: 'Needs judgment', needsJudgment: true, note: 'No mechanical answer — a person must decide.' },
  expertise: { label: 'Needs expertise', needsJudgment: true, note: 'Specialist / counsel call (legal, valuation, going concern).' },
};

const TIERS = {
  assert: {
    key: 'assert',
    label: 'Auto-verified',
    blurb: 'High confidence and deterministic. The reviewer can rely on this without re-deriving it.',
  },
  flag: {
    key: 'flag',
    label: 'Flag for reviewer',
    blurb: 'The reviewer should confirm this against a source before sign-off. Objective, but the tool cannot see the document.',
  },
  escalate: {
    key: 'escalate',
    label: 'Second opinion required',
    blurb: 'Low confidence or a judgment call. The tool deliberately does not opine — route to a person.',
  },
};

/**
 * Derive the tier for a raw finding.
 * @param {object} f raw finding with { detectionConfidence, resolution, autoEscalate, passed }
 */
function deriveTier(f, policy = DEFAULT_POLICY) {
  if (f.autoEscalate) return 'escalate';

  const res = RESOLUTION[f.resolution];
  if (!res) return 'escalate'; // unknown resolution → be cautious

  if (res.needsJudgment) return 'escalate';
  if (typeof f.detectionConfidence === 'number' && f.detectionConfidence < policy.confidenceFloor) {
    return 'escalate';
  }
  if ((f.resolution === 'arithmetic' || f.resolution === 'rule') && f.detectionConfidence >= 0.9) {
    return 'assert';
  }
  // medium confidence, or needs a source document → flag
  return 'flag';
}

/**
 * Enrich a raw finding into the shape the API/UI consumes.
 */
function enrich(f, policy = DEFAULT_POLICY) {
  const tier = deriveTier(f, policy);
  const res = RESOLUTION[f.resolution] || RESOLUTION.judgment;
  // Deterministic id so a reviewer's disposition re-attaches on the next run.
  const stableId = f.id || `${f.rule}:${String(f.title || '').toLowerCase().replace(/\W+/g, '_').slice(0, 40)}`;
  return {
    id: stableId,
    rule: f.rule,
    title: f.title,
    detail: f.detail || '',
    category: f.category || 'content', // 'content' | 'control' | 'engine'
    severity: f.severity || 'info', // 'info' | 'low' | 'medium' | 'high'
    passed: f.passed === undefined ? null : !!f.passed,
    tier,
    secondOpinion: tier === 'escalate',
    detectionConfidence: typeof f.detectionConfidence === 'number' ? f.detectionConfidence : null,
    resolution: f.resolution,
    resolutionLabel: res.label,
    resolutionNote: res.note,
    autoEscalate: !!f.autoEscalate,
    escalateReason: f.escalateReason || (f.autoEscalate ? 'Auto-escalated' : null),
    evidence: f.evidence || [],
  };
}

module.exports = { RESOLUTION, TIERS, deriveTier, enrich };
