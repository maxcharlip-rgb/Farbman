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
    children: [runs('Monthly Property Report', { size: 18, color: MUTED, characterSpacing: 20 })],
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

  // Executive summary
  if (es.narrative || es.monthTotalRevenue != null || es.ytdNOI != null) {
    children.push(heading('Executive Summary'));
    const figs = [];
    if (es.ytdNOI != null) figs.push(`YTD NOI ${money(es.ytdNOI)}`);
    if (es.monthTotalRevenue != null) figs.push(`Period revenue ${money(es.monthTotalRevenue)}`);
    if (es.monthOperatingExpenses != null) figs.push(`operating expenses ${money(es.monthOperatingExpenses)}`);
    if (es.occupancyPct != null) figs.push(`occupancy ${es.occupancyPct}%`);
    if (figs.length) children.push(body(figs.join(' · ') + '.'));
    if (es.narrative) children.push(body(es.narrative));
  }

  // Income statement
  if (is.revenue || is.expenses) {
    children.push(heading('Income Statement'));
    const rows = [];
    (is.revenue || []).forEach((l) => rows.push({ label: l.label, amount: l.amount }));
    if (is.totalRevenue != null) rows.push({ label: 'Total Revenue', amount: is.totalRevenue, total: true });
    (is.expenses || []).forEach((l) => rows.push({ label: l.label, amount: l.amount }));
    if (is.totalExpenses != null) rows.push({ label: 'Total Expenses', amount: is.totalExpenses, total: true });
    if (is.noiPTD != null) rows.push({ label: 'Net Operating Income (PTD)', amount: is.noiPTD, total: true });
    children.push(finTable(rows));
  }

  // Balance summary
  if (report.balance) {
    const b = report.balance;
    children.push(heading('Balance Summary'));
    children.push(finTable([
      { label: 'Beginning Cash', amount: b.beginningCash },
      { label: 'Net Cash Flow (Period)', amount: b.netCashFlow },
      { label: 'Ending Cash', amount: b.endingCash, total: true },
    ]));
  }

  // Receivables aging
  if (ar) {
    children.push(heading('Receivables Aging'));
    children.push(finTable([
      { label: 'Current', amount: ar.current },
      { label: '0–30 Days', amount: ar.d0_30 },
      { label: '30–60 Days', amount: ar.d30_60 },
      { label: '60–90 Days', amount: ar.d60_90 },
      { label: '90+ Days', amount: ar.d90_plus },
      { label: 'Total', amount: ar.total, total: true },
    ]));
  }

  // Narrative sections
  for (const sec of Object.values(report.narrative || {})) {
    const text = sec.revisedText || sec.text;
    if (!text) continue;
    children.push(heading(sec.title));
    children.push(body(text));
  }

  // Bank rec note
  if (report.bankRec && report.bankRec.note) {
    children.push(heading('Bank Reconciliation Note'));
    children.push(body(report.bankRec.note));
  }

  // Footnotes
  const fns = report.footnotes ? Object.entries(report.footnotes) : [];
  if (fns.length) {
    children.push(heading('Footnotes'));
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
