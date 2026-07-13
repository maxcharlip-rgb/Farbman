'use strict';

/**
 * Review policy — the configurable knobs a firm would tune per division.
 * Everything the engine treats as a threshold lives here so nothing is hard-coded
 * inside a rule. A real deployment would load this per division / per client.
 */
const DEFAULT_POLICY = {
  // Arithmetic tolerance (dollars) for "foots" / "ties" checks.
  footTolerance: 0.01,

  // Reviewer must complete a *full* report review, not just the executive summary.
  requireFullReview: true,

  // Max days from period close to reviewer sign-off before timeliness is flagged.
  maxDaysCloseToReview: 10,

  // A review touching fewer than this many minutes on a report that still has open
  // problem findings is flagged as a possible rubber-stamp.
  minReviewMinutes: 10,

  // Round-number accrual detector: an expense >= this amount that is an exact
  // multiple of `roundStep` is treated as a likely estimate/accrual.
  roundNumberFloor: 5000,
  roundStep: 1000,

  // Cash reconciliation: |Net Cash Flow − Period NOI| above this wants a recon note.
  cashVsNoiGap: 1500,

  // Month-over-month line-item swing (absolute $ and relative %) that warrants a look.
  momSwingAbs: 5000,
  momSwingPct: 0.4,

  // Detection-confidence floor below which any finding auto-escalates to second opinion.
  confidenceFloor: 0.55,

  // ── Narrative audit (per J. Margolis: most review time goes to the narrative) ──
  // Sections every monthly report must carry.
  requiredNarrativeSections: ['budgetVariance', 'arNotes'],
  // Similarity (0..1) at/above which a note counts as carried over from last month.
  staleNoteSimilarity: 0.92,

  // ── Public-record redaction (receivership reports are filed publicly) ──
  redactionDivisions: ['Receivership'],
  // A contiguous digit run this long or longer looks like an account number.
  redactionMinDigits: 7,
};

module.exports = { DEFAULT_POLICY };
