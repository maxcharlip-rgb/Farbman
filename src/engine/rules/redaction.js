'use strict';

/**
 * Public-record redaction scan — receivership reports are filed with the court and
 * become public record, so bank account numbers must not appear except the last
 * 3–4 digits (per asset management, this is a manual check they do on every
 * receivership report today).
 *
 * The scan is a pattern check over every narrative/free-text field: any contiguous
 * digit run of `redactionMinDigits`+ looks like an account or routing number.
 * Masked forms ("****7894", "ending 7894") are inherently safe — they never reach
 * the digit-run threshold. Money, dates, and check numbers stay under it too.
 */
function collectTexts(report) {
  const out = [];
  if (report.execSummary && report.execSummary.narrative) out.push(['Executive Summary', report.execSummary.narrative]);
  for (const [key, sec] of Object.entries(report.narrative || {})) {
    const text = sec.revisedText || sec.text;
    if (text) out.push([sec.title || key, text]);
  }
  if (report.bankRec && report.bankRec.note) out.push(['Bank rec note', report.bankRec.note]);
  for (const [k, v] of Object.entries(report.footnotes || {})) out.push([`Footnote ${k}`, v]);
  return out;
}

const mask = (digits) => `${digits.slice(0, 2)}…${digits.slice(-3)}`;

function redactionRules(report, policy) {
  if (!(policy.redactionDivisions || []).includes(report.division)) return [];

  const re = new RegExp(`\\d{${policy.redactionMinDigits},}`, 'g');
  const hits = [];
  for (const [where, text] of collectTexts(report)) {
    for (const m of String(text).matchAll(re)) {
      hits.push({ where, digits: m[0] });
    }
  }

  if (hits.length) {
    return [
      {
        id: 'redaction.accounts',
        rule: 'redaction.accounts',
        title: `Unredacted account-style number in a public-record report (${hits.length} occurrence${hits.length > 1 ? 's' : ''})`,
        category: 'content',
        resolution: 'rule',
        detectionConfidence: 0.95,
        passed: false,
        severity: 'high',
        detail:
          'Receivership reports become public record when filed. Bank account numbers must be redacted ' +
          'to the last 3–4 digits everywhere in the report. Remove the full number(s) before release — ' +
          'this is the check asset management performs by hand today.',
        evidence: hits.map((h) => `${h.where}: ${mask(h.digits)} (${h.digits.length} digits)`),
      },
    ];
  }

  return [
    {
      id: 'redaction.accounts',
      rule: 'redaction.accounts',
      title: 'Public-record redaction scan passed — no unredacted account numbers detected',
      category: 'content',
      resolution: 'rule',
      detectionConfidence: 0.9,
      passed: true,
      severity: 'info',
      detail:
        'No account-style digit runs found in the narrative, notes, or bank rec text. Pattern scan only — ' +
        'the reviewer still owns the final visual check before filing.',
      evidence: [`scanned ${collectTexts(report).length} text field(s), min run = ${policy.redactionMinDigits} digits`],
    },
  ];
}

module.exports = { redactionRules };
