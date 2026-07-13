'use strict';

/**
 * Optional reviewer briefing.
 *
 * If ANTHROPIC_API_KEY is set, the engine's deterministic findings are handed to
 * Claude to write a short plain-English briefing for the human reviewer. The model
 * is used ONLY to summarize and prioritize what the deterministic engine already
 * found — it is never the source of truth, and the prompt forbids it from inventing
 * numbers or declaring the report approved.
 *
 * If no key is present (the default for the company to just run it), a deterministic
 * briefing is generated from the findings so the panel always shows something useful.
 */
const MODEL = process.env.FARBMAN_REVIEW_MODEL || 'claude-opus-4-8';

function deterministicBriefing(review) {
  const esc = review.findings.filter((f) => f.tier === 'escalate');
  const flag = review.findings.filter((f) => f.tier === 'flag');
  const brokenAsserts = review.findings.filter((f) => f.tier === 'assert' && f.passed === false);

  const lines = [];
  lines.push(`Reviewer briefing for ${review.property.property} — ${review.property.period.label}.`);
  lines.push('');
  lines.push(review.summary.headline);
  lines.push('');
  if (brokenAsserts.length) {
    lines.push('Start here — deterministic exceptions (the tool is sure of these):');
    brokenAsserts.forEach((f) => lines.push(`  • ${f.title}`));
    lines.push('');
  }
  if (esc.length) {
    lines.push('Needs your judgment — second opinion required:');
    esc.forEach((f) => lines.push(`  • ${f.title}`));
    lines.push('');
  }
  if (flag.length) {
    lines.push('Confirm against a source before sign-off:');
    flag.forEach((f) => lines.push(`  • ${f.title}`));
    lines.push('');
  }
  lines.push('Nothing here is an approval — the supervisor sign-off still stands on its own.');
  return { source: 'deterministic', model: null, text: lines.join('\n') };
}

async function claudeBriefing(review) {
  const payload = {
    property: review.property,
    summary: review.summary,
    findings: review.findings.map((f) => ({
      tier: f.tier,
      title: f.title,
      detail: f.detail,
      category: f.category,
      severity: f.severity,
      resolution: f.resolutionLabel,
      passed: f.passed,
    })),
  };

  const system =
    'You are a first-pass review assistant for a commercial property-management accounting team. ' +
    'You are given the deterministic findings from a rules engine that already reviewed a draft ' +
    'financial report. Write a concise briefing (max ~180 words) for the human reviewer. Rules: ' +
    '(1) Only summarize and prioritize the findings provided — never invent numbers or new issues. ' +
    '(2) Lead with anything the engine is certain of, then judgment items, then source-doc checks. ' +
    '(3) Never say the report is approved, correct, or passes — you assist the reviewer, you do not ' +
    'sign off. (4) Be specific and skimmable. Plain text, short lines.';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system,
      messages: [{ role: 'user', content: 'Findings JSON:\n' + JSON.stringify(payload, null, 2) }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join('').trim();
  return { source: 'claude', model: MODEL, text };
}

async function generateBriefing(review) {
  if (!process.env.ANTHROPIC_API_KEY) return deterministicBriefing(review);
  try {
    return await claudeBriefing(review);
  } catch (e) {
    const fallback = deterministicBriefing(review);
    fallback.warning = `LLM briefing unavailable (${e.message}); showing deterministic briefing.`;
    return fallback;
  }
}

module.exports = { generateBriefing };
