'use strict';

/**
 * Narrative audit — built directly from asset management's feedback (J. Margolis):
 * most review time goes to the narrative portions (executive summary, budget
 * variance notes, AR notes), and the top recurring problems are:
 *   1. notes carried over verbatim from the prior month,
 *   2. notes that revert to pre-revision text (the reviewer's edits get lost when
 *      the next month's report is drafted from an old file),
 *   3. incomplete sentences.
 *
 * Sections live on report.narrative[key] = { title, text, revisedText? } where
 * `revisedText` is what the reviewer changed the note to during that month's
 * review. The operative ("final") text of a period is revisedText || text.
 */

const SECTION_TITLES = {
  execSummary: 'Executive Summary',
  budgetVariance: 'Budget Variance Notes',
  arNotes: 'AR Notes',
};

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const tokens = (s) => norm(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

/** Dice coefficient on word multisets — cheap, order-insensitive, good enough for "is this the same note". */
function similarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length && !tb.length) return 1;
  if (!ta.length || !tb.length) return 0;
  const counts = new Map();
  for (const t of tb) counts.set(t, (counts.get(t) || 0) + 1);
  let inter = 0;
  for (const t of ta) {
    const c = counts.get(t) || 0;
    if (c > 0) {
      inter += 1;
      counts.set(t, c - 1);
    }
  }
  return (2 * inter) / (ta.length + tb.length);
}

/** All narrative sections of a report as [key, title, finalText]. */
function sections(report) {
  const out = [];
  if (report.execSummary && norm(report.execSummary.narrative)) {
    out.push(['execSummary', SECTION_TITLES.execSummary, norm(report.execSummary.narrative)]);
  }
  for (const [key, sec] of Object.entries(report.narrative || {})) {
    const finalText = norm(sec.revisedText || sec.text);
    if (finalText) out.push([key, sec.title || SECTION_TITLES[key] || key, finalText]);
  }
  return out;
}

const snippet = (s, n = 70) => (s.length > n ? s.slice(0, n) + '…' : s);

/**
 * Same-period quality checks: required sections present + incomplete-sentence
 * heuristics. Heuristic, so these flag (never assert) — the reviewer confirms.
 */
function narrativeQualityRules(report, policy) {
  const out = [];

  // 1) Required sections present.
  const required = policy.requiredNarrativeSections || [];
  if (required.length) {
    const missing = required.filter((k) => {
      const sec = report.narrative && report.narrative[k];
      return !(sec && norm(sec.revisedText || sec.text));
    });
    if (missing.length) {
      out.push({
        id: 'narrative.sections_missing',
        rule: 'narrative.sections',
        title: `Required narrative section${missing.length > 1 ? 's' : ''} missing: ${missing.map((k) => SECTION_TITLES[k] || k).join(', ')}`,
        category: 'content',
        resolution: 'rule',
        detectionConfidence: 0.92,
        passed: false,
        severity: 'medium',
        detail:
          'The monthly report template calls for these narrative sections. Reviewers spend most of ' +
          'their time on the narrative — a missing section usually means the draft went out early.',
        evidence: missing.map((k) => `missing: ${k}`),
      });
    } else {
      out.push({
        id: 'narrative.sections_ok',
        rule: 'narrative.sections',
        title: 'All required narrative sections present',
        category: 'content',
        resolution: 'rule',
        detectionConfidence: 0.92,
        passed: true,
        severity: 'info',
        detail: `Present: ${required.map((k) => SECTION_TITLES[k] || k).join(', ')}.`,
        evidence: required.map((k) => `present: ${k}`),
      });
    }
  }

  // 2) Incomplete-sentence heuristics per section.
  for (const [key, title, text] of sections(report)) {
    const issues = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      const t = s.trim();
      if (/^[a-z]/.test(t)) issues.push(`sentence starts lowercase: "${snippet(t)}"`);
    }
    if (!/[.!?]$/.test(text)) issues.push(`section does not end with terminal punctuation: "…${snippet(text.slice(-50), 50)}"`);
    if (issues.length) {
      out.push({
        id: `narrative.fragment.${key}`,
        rule: 'narrative.fragment',
        title: `Possible incomplete sentence(s) in ${title}`,
        category: 'content',
        resolution: 'rule',
        detectionConfidence: 0.7,
        severity: 'low',
        detail:
          `${title} contains text that reads as unfinished — a top recurring issue called out by asset ` +
          'management. Heuristic check: confirm and clean up before release.',
        evidence: issues,
      });
    }
  }

  return out;
}

/**
 * Prior-period continuity: stale carry-overs and reverted notes. Needs the prior
 * report. Reverted notes (reviewer's revision silently lost) are deterministic
 * exceptions; verbatim carry-overs escalate — only the reviewer knows whether an
 * unchanged note is legitimate this month.
 */
function narrativeContinuityRules(report, prior, policy) {
  const out = [];
  const currSections = { ...(report.narrative || {}) };
  if (report.execSummary && norm(report.execSummary.narrative)) {
    currSections.execSummary = { title: SECTION_TITLES.execSummary, text: report.execSummary.narrative };
  }
  const priorSections = { ...(prior.narrative || {}) };
  if (prior.execSummary && norm(prior.execSummary.narrative)) {
    priorSections.execSummary = { title: SECTION_TITLES.execSummary, text: prior.execSummary.narrative };
  }

  for (const [key, cur] of Object.entries(currSections)) {
    const curText = norm(cur.revisedText || cur.text);
    const prev = priorSections[key];
    if (!curText || !prev || !norm(prev.text)) continue;
    const title = cur.title || SECTION_TITLES[key] || key;
    const priorFinal = norm(prev.revisedText || prev.text);
    const priorDraft = norm(prev.text);
    const simFinal = similarity(curText, priorFinal);
    const simDraft = similarity(curText, priorDraft);

    // Reverted: matches the prior *pre-revision* draft, not the reviewer's revision.
    if (prev.revisedText && simDraft >= 0.9 && simFinal < 0.9 && simDraft > simFinal) {
      out.push({
        id: `narrative.reverted.${key}`,
        rule: 'narrative.reverted',
        title: `${title} reverted to pre-revision text — last month's reviewer edits are gone`,
        category: 'content',
        resolution: 'rule',
        detectionConfidence: 0.9,
        passed: false,
        severity: 'high',
        detail:
          `This month's ${title} matches the prior month's ORIGINAL draft, not the version the reviewer ` +
          'revised it to. This is the exact failure asset management flagged: the new report was drafted ' +
          "from an old file and the reviewer's revisions were silently lost. Re-apply the revision.",
        evidence: [
          `current: "${snippet(curText, 110)}"`,
          `prior as revised by reviewer: "${snippet(priorFinal, 110)}"`,
          `prior original draft: "${snippet(priorDraft, 110)}"`,
          `similarity to draft = ${simDraft.toFixed(2)}, to revision = ${simFinal.toFixed(2)}`,
        ],
      });
      continue;
    }

    // Stale: carried over from last month (verbatim or near-verbatim).
    if (simFinal >= 0.98) {
      out.push({
        id: `narrative.stale.${key}`,
        rule: 'narrative.stale',
        title: `${title} is carried over verbatim from last month`,
        category: 'content',
        resolution: 'judgment',
        detectionConfidence: 0.95,
        severity: 'medium',
        escalateReason: 'Only the reviewer knows whether this note should have changed this month.',
        detail:
          `This month's ${title} is identical to last month's. Sometimes that is legitimate — but ` +
          'carried-over notes are the #1 recurring issue asset management sees, so it needs a human eye.',
        evidence: [`text: "${snippet(curText, 110)}"`, `similarity to prior = ${simFinal.toFixed(2)}`],
      });
    } else if (simFinal >= policy.staleNoteSimilarity) {
      out.push({
        id: `narrative.stale.${key}`,
        rule: 'narrative.stale',
        title: `${title} is nearly unchanged from last month`,
        category: 'content',
        resolution: 'judgment',
        detectionConfidence: 0.75,
        severity: 'low',
        escalateReason: 'Near-identical notes month over month usually mean a copy-forward.',
        detail: `This month's ${title} is ${Math.round(simFinal * 100)}% similar to last month's — confirm it was intentionally reviewed, not copied forward.`,
        evidence: [`similarity to prior = ${simFinal.toFixed(2)}`],
      });
    }
  }

  return out;
}

module.exports = { narrativeQualityRules, narrativeContinuityRules, similarity, SECTION_TITLES };
