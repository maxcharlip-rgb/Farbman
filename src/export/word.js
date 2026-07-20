'use strict';

/**
 * Build a Word (.docx) copy of a property report — the deliverable a reviewer
 * sends out. Uses the same report data the UI renders. Financials + narrative,
 * plus a review attestation line when the report has been signed off.
 *
 * Pure JS (the `docx` library has no native bindings), so it installs and runs
 * cleanly on the deploy host.
 */

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, HeadingLevel, ShadingType,
} = require('docx');

const NAVY = '1F3A5F';
const INK = '161B22';
const MUTED = '6B7888';
const RED = 'A23A32';
const LINE = 'D8D5CD';

const money = (n) => {
  if (n == null || isNaN(n)) return '—';
  const s = Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-$' : '$') + s;
};

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── small paragraph builders ───────────────────────────
const runs = (text, opts = {}) => new TextRun({ text, ...opts });

function heading(text) {
  return new Paragraph({
    spacing: { before: 260, after: 90 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE } },
    children: [runs(text, { bold: true, size: 24, color: NAVY })],
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [runs(text, { size: 21, color: INK, ...opts })],
  });
}

// ── financial tables ───────────────────────────────────
function cell(children, { align, width, shading, bold } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: shading ? { type: ShadingType.CLEAR, fill: shading } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: Array.isArray(children) ? children : [runs(String(children), { size: 20, bold: !!bold, color: INK })],
      }),
    ],
  });
}

function moneyRun(n, bold) {
  return runs(money(n), { size: 20, bold: !!bold, color: n < 0 ? RED : INK });
}

function finTable(rows) {
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const hair = { style: BorderStyle.SINGLE, size: 2, color: 'F0EEE8' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideVertical: noBorder, insideHorizontal: hair },
    rows: rows.map((r) => new TableRow({
      children: [
        cell([runs(r.label, { size: 20, bold: !!r.total, color: r.total ? NAVY : INK })], { width: 68 }),
        cell([moneyRun(r.amount, !!r.total)], { align: 'right', width: 32 }),
      ],
    })),
  });
}

const moneyParen = (n) => (n < 0 ? '($' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ')' : money(n));
function monthName(p) {
  try { return new Date(p.month + '-15').toLocaleString('en-US', { month: 'long', year: 'numeric' }); }
  catch { return (p && p.label) || ''; }
}
function subhead(text) {
  return new Paragraph({ spacing: { before: 180, after: 60 }, children: [runs(String(text).toUpperCase(), { bold: true, size: 18, color: NAVY, characterSpacing: 16 })] });
}
function yardiFooter(report, name) {
  return new Paragraph({ spacing: { after: 100 },
    children: [runs(report.property + ' (' + (report.propertyId || '') + ') · ' + name + ' · Period = ' + monthName(report.period) + ' · Book = Cash', { size: 14, color: 'A8A294' })] });
}
// The three standard Financial Highlights paragraphs (company language).
function financialHighlights(r) {
  const es = r.execSummary || {};
  const m = monthName(r.period);
  const year = ((r.period && r.period.month) || '').slice(0, 4);
  const out = [];
  if (r.balance && r.balance.endingCash != null) out.push('As of ' + m + ' the ending cash balance is: ' + money(r.balance.endingCash) + '.');
  if (es.monthTotalRevenue != null && es.monthRevenueVarianceToBudget != null) {
    const v = es.monthRevenueVarianceToBudget, b = es.monthTotalRevenue - v;
    out.push('The ' + m + ' Total Revenue was ' + money(es.monthTotalRevenue) + '. This reflects ' + (v >= 0 ? 'a favorable variance of ' + money(v) : 'an unfavorable variance of ' + moneyParen(v)) + ' as it relates to the total revenue projection within the ' + year + ' budget of ' + money(b) + '. See variance report for details.');
  }
  if (es.monthOperatingExpenses != null && es.monthExpenseVarianceToBudget != null) {
    const v = es.monthExpenseVarianceToBudget, b = es.monthOperatingExpenses - v;
    out.push('The ' + m + ' Operating Expenses were ' + money(es.monthOperatingExpenses) + '. This reflects ' + (v <= 0 ? 'a favorable variance of ' + money(-v) : 'an unfavorable variance of ' + moneyParen(-v)) + ' as it relates to the expense projection within the ' + year + ' budget of ' + money(b) + '. See variance report for details.');
  }
  if (es.ytdNOI != null && es.ytdNOIVarianceToBudget != null) {
    const v = es.ytdNOIVarianceToBudget, b = es.ytdNOI - v;
    out.push('The Year-to-Date Net Operating Income through ' + m + ' is ' + money(es.ytdNOI) + '. This reflects ' + (v >= 0 ? 'a favorable variance of ' + money(v) : 'an unfavorable variance of ' + moneyParen(v)) + ' as it relates to the Year-to-Date Net Operating Income projections within the ' + year + ' budget of ' + money(b) + '. See variance report for details.');
  }
  return out;
}
const OPERATIONAL_ORDER = [
  ['leasingActivity', 'Leasing Activity'], ['salesActivity', 'Sales Activity'], ['marketingActivity', 'Marketing Activity'],
  ['significantTenantIssues', 'Significant Tenant Issues'], ['operationalIssues', 'Operational Issues'],
  ['capitalProjects', 'Capital Projects'], ['realEstateTaxes', 'Real Estate Taxes'], ['insurance', 'Insurance'],
  ['legal', 'Legal'], ['receivershipFees', 'Receivership Fees'], ['protectiveAdvances', 'Protective Advances'],
];
function kvTable(pairs) {
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideVertical: noBorder, insideHorizontal: noBorder },
    rows: pairs.map(([k, v]) => new TableRow({
      children: [
        cell([runs(k + ':', { size: 19, color: MUTED })], { width: 30 }),
        cell([runs(String(v), { size: 19, color: INK })], { width: 70 }),
      ],
    })),
  });
}

// ── document ───────────────────────────────────────────
function buildChildren(report, ctx) {
  const { property, signoff } = ctx || {};
  const is = report.incomeStatement || {};
  const es = report.execSummary || {};
  const ar = report.receivablesAging;
  const children = [];

  // Masthead
  children.push(new Paragraph({
    spacing: { after: 20 },
    children: [runs('FARBMAN GROUP', { bold: true, size: 18, color: NAVY, characterSpacing: 30 })],
  }));
  children.push(new Paragraph({
    spacing: { after: 40 },
    children: [runs('Monthly Financial Report', { size: 18, color: MUTED, characterSpacing: 20 })],
  }));
  children.push(new Paragraph({
    spacing: { after: 30 },
    children: [runs(report.property, { bold: true, size: 30, color: INK })],
  }));
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [runs(`${report.division} · ${report.period ? report.period.label : ''}`, { size: 20, color: MUTED })],
  }));

  // Attribution + attestation
  const attrib = [];
  if (report.preparedBy) attrib.push(`Prepared by ${report.preparedBy.name}`);
  if (report.reviewedBy) attrib.push(`Reviewed by ${report.reviewedBy.name}`);
  if (attrib.length) children.push(new Paragraph({ spacing: { after: 40 }, children: [runs(attrib.join('  ·  '), { size: 19, color: MUTED })] }));

  if (signoff) {
    children.push(new Paragraph({
      spacing: { before: 40, after: 120 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE } },
      children: [runs(`Reviewed and signed off by ${signoff.by} on ${fmtDate(signoff.at)}. All exceptions were dispositioned before sign-off.`,
        { size: 19, italics: true, color: NAVY })],
    }));
  }

  // ── 1. Executive Summary ──────────────────────────────
  children.push(heading('1. Executive Summary'));
  if (report.overview) {
    const ov = report.overview;
    children.push(subhead('Property Overview'));
    const pairs = [
      ['Property', report.property], ['Address', ov.address], ['Property Type', ov.propertyType],
      ['Year Built', ov.yearBuilt], ['Rentable Sq Feet', ov.rentableSqFt != null ? Number(ov.rentableSqFt).toLocaleString('en-US') : null],
      ['Parking', ov.parking], ['Occupancy', es.occupancyPct != null ? es.occupancyPct + '%' : null],
      ['Date Appointed', ov.dateAppointed], ['Court', ov.court], ['Judge', ov.judge], ['Case Number', ov.caseNumber],
      ['Receiver', ov.receiver], ["Receiver's Counsel", ov.receiversCounsel], ['Plaintiff', ov.plaintiff], ['Defendant', ov.defendant],
      ['Managed By', ov.managedBy], ['Property Manager', report.reviewedBy ? report.reviewedBy.name : null],
      ['Property Accountant', report.preparedBy ? report.preparedBy.name : null],
    ].filter(([, v]) => v != null && v !== '');
    children.push(kvTable(pairs));
  }
  const highlights = financialHighlights(report);
  if (highlights.length) {
    children.push(subhead('Financial Highlights'));
    highlights.forEach((p) => children.push(body(p)));
  } else if (es.narrative) {
    children.push(body(es.narrative));
  }
  if (report.operational) {
    for (const [key, label] of OPERATIONAL_ORDER) {
      if (!report.operational[key]) continue;
      children.push(new Paragraph({ spacing: { after: 60 },
        children: [runs(label + ': ', { size: 20, bold: true, color: INK }), runs(String(report.operational[key]), { size: 20, color: INK })] }));
    }
  }
  if (es.narrative && highlights.length) {
    children.push(new Paragraph({ spacing: { after: 60 },
      children: [runs('Status: ', { size: 20, bold: true, color: INK }), runs(es.narrative, { size: 20, color: INK })] }));
  }

  // ── 2. Financial Statements ───────────────────────────
  children.push(heading('2. Financial Statements'));
  if (is.revenue || is.expenses) {
    children.push(subhead('Income Statement'));
    const rows = [];
    (is.revenue || []).forEach((l) => rows.push({ label: l.label, amount: l.amount }));
    if (is.totalRevenue != null) rows.push({ label: 'TOTAL REVENUE', amount: is.totalRevenue, total: true });
    (is.expenses || []).forEach((l) => rows.push({ label: l.label, amount: l.amount }));
    if (is.totalExpenses != null) rows.push({ label: 'TOTAL EXPENSES', amount: is.totalExpenses, total: true });
    if (is.noiPTD != null) rows.push({ label: 'NET OPERATING INCOME', amount: is.noiPTD, total: true });
    children.push(finTable(rows));
    children.push(yardiFooter(report, 'Income Statement'));
  }
  // Budget Comparison — Actual | Budget | Variance | % Var
  const bcRows = [];
  if (es.monthTotalRevenue != null && es.monthRevenueVarianceToBudget != null)
    bcRows.push(['Total Revenue', es.monthTotalRevenue, es.monthTotalRevenue - es.monthRevenueVarianceToBudget, es.monthRevenueVarianceToBudget]);
  if (es.monthOperatingExpenses != null && es.monthExpenseVarianceToBudget != null)
    bcRows.push(['Total Expenses', es.monthOperatingExpenses, es.monthOperatingExpenses - es.monthExpenseVarianceToBudget, -es.monthExpenseVarianceToBudget]);
  if (es.ytdNOI != null && es.ytdNOIVarianceToBudget != null)
    bcRows.push(['YTD Net Operating Income', es.ytdNOI, es.ytdNOI - es.ytdNOIVarianceToBudget, es.ytdNOIVarianceToBudget]);
  if (bcRows.length) {
    children.push(subhead('Budget Comparison'));
    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const hair = { style: BorderStyle.SINGLE, size: 2, color: 'F0EEE8' };
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideVertical: noBorder, insideHorizontal: hair },
      rows: [
        new TableRow({ children: ['', 'Actual', 'Budget', 'Variance', '% Var'].map((t, i) =>
          cell([runs(t, { size: 16, bold: true, color: MUTED })], { align: i ? 'right' : 'left', width: i ? 17 : 32 })) }),
        ...bcRows.map(([label, act, bud, vr]) => {
          const pct = bud ? (vr / Math.abs(bud)) * 100 : null;
          return new TableRow({ children: [
            cell([runs(label, { size: 20, color: INK })], { width: 32 }),
            cell([moneyRun(act)], { align: 'right', width: 17 }),
            cell([moneyRun(bud)], { align: 'right', width: 17 }),
            cell([runs(moneyParen(vr), { size: 20, color: vr < 0 ? RED : INK })], { align: 'right', width: 17 }),
            cell([runs(pct == null ? 'N/A' : pct.toFixed(1) + '%', { size: 20, color: vr < 0 ? RED : INK })], { align: 'right', width: 17 }),
          ] });
        }),
      ],
    }));
    children.push(yardiFooter(report, 'Budget Comparison'));
  }
  const bv = report.narrative && report.narrative.budgetVariance;
  if (bv && (bv.revisedText || bv.text)) {
    children.push(subhead('Variance Analytics'));
    children.push(body(bv.revisedText || bv.text));
  }
  if (report.balance) {
    const b = report.balance;
    children.push(subhead('Cash Flow'));
    children.push(finTable([
      { label: 'Beginning Cash', amount: b.beginningCash },
      { label: 'Net Cash Flow (Period)', amount: b.netCashFlow },
      { label: 'ENDING CASH', amount: b.endingCash, total: true },
    ]));
    children.push(yardiFooter(report, 'Cash Flow Statement'));
  }

  // ── 4. Accounts Receivable ────────────────────────────
  if (ar) {
    children.push(heading('4. Accounts Receivable'));
    children.push(finTable([
      { label: 'Current', amount: ar.current },
      { label: '0–30 Days', amount: ar.d0_30 },
      { label: '31–60 Days', amount: ar.d30_60 },
      { label: '61–90 Days', amount: ar.d60_90 },
      { label: 'Over 90', amount: ar.d90_plus },
      { label: 'TOTAL', amount: ar.total, total: true },
    ]));
    children.push(yardiFooter(report, 'Aging Status'));
    const arn = report.narrative && report.narrative.arNotes;
    if (arn && (arn.revisedText || arn.text)) {
      children.push(new Paragraph({ spacing: { after: 60 },
        children: [runs('AR Notes: ', { size: 20, bold: true, color: INK }), runs(arn.revisedText || arn.text, { size: 20, color: INK })] }));
    }
  }

  // ── 5. Bank Reconciliation ────────────────────────────
  if (report.bankRec) {
    children.push(heading('5. Bank Reconciliation'));
    const cs = report.bankRec.checkSequence;
    if (cs) {
      const seq = [];
      if ((cs.issued || []).length) seq.push({ label: 'Checks issued ' + cs.issued[0] + '–' + cs.issued[cs.issued.length - 1], amount: null });
      children.push(body('Checks issued: ' + ((cs.issued || []).length ? cs.issued[0] + '–' + cs.issued[cs.issued.length - 1] : '—') +
        '   ·   Cleared: ' + ((cs.cleared || []).join(', ') || '—') +
        '   ·   Outstanding: ' + ((cs.outstanding || []).join(', ') || 'None')));
      if (report.balance) children.push(finTable([{ label: 'Reconciled Balance per G/L', amount: report.balance.endingCash, total: true }]));
    }
    if (report.bankRec.note) children.push(body(report.bankRec.note));
    children.push(yardiFooter(report, 'Bank Reconciliation Report'));
  }

  // Remaining narrative sections (not already placed above)
  for (const [key, sec] of Object.entries(report.narrative || {})) {
    if (key === 'budgetVariance' || key === 'arNotes') continue;
    const text = sec.revisedText || sec.text;
    if (!text) continue;
    children.push(subhead(sec.title));
    children.push(body(text));
  }

  // Footnotes
  const fns = report.footnotes ? Object.entries(report.footnotes) : [];
  if (fns.length) {
    children.push(subhead('Footnotes'));
    fns.forEach(([k, v]) => children.push(new Paragraph({
      spacing: { after: 40 },
      children: [runs(`${k}. `, { size: 18, bold: true, color: NAVY }), runs(String(v), { size: 18, color: MUTED })],
    })));
  }

  // Disclaimer
  children.push(new Paragraph({
    spacing: { before: 300 },
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE } },
    children: [runs('Prepared with Farbman first-pass review automation. The engine flags material items; the human reviewer dispositions them and the supervisor signs off. Advisory only.',
      { size: 16, italics: true, color: MUTED })],
  }));

  return children;
}

async function buildReportDocx(report, ctx = {}) {
  const doc = new Document({
    creator: 'Farbman Group',
    title: report.property,
    description: `Monthly property report — ${report.period ? report.period.label : ''}`,
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: buildChildren(report, ctx),
    }],
  });
  return Packer.toBuffer(doc);
}

// A filesystem-safe filename for the downloaded document.
function docxFilename(report) {
  const base = `${report.property} - ${report.period ? report.period.label : 'report'}`;
  return base.replace(/[\/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) + '.docx';
}

// Build a header-safe Content-Disposition. HTTP headers are Latin-1 only, so the
// `filename=` fallback is ASCII-folded (en/em dashes → '-', other non-ASCII dropped),
// and `filename*` carries the real UTF-8 name (RFC 5987) for modern browsers.
function contentDisposition(report) {
  const name = docxFilename(report);
  const ascii = name.replace(/[‒-―]/g, '-').replace(/[^\x20-\x7E]/g, '').replace(/"/g, '');
  const encoded = encodeURIComponent(name);
  return `attachment; filename="${ascii || 'report.docx'}"; filename*=UTF-8''${encoded}`;
}

module.exports = { buildReportDocx, docxFilename, contentDisposition };
