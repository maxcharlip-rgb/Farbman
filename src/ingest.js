'use strict';

/**
 * Report ingestion. A real deployment feeds drafts straight from the accounting
 * system (Yardi / MRI / AppFolio exports). Here we accept either a normalized JSON
 * report or a simple, documented "long" CSV the accountant can export/fill:
 *
 *   section,label,amount
 *   meta,property,28000 Example Rd — Receivership
 *   meta,division,Receivership
 *   meta,period_label,April 1–30 2026
 *   meta,period_month,2026-04
 *   meta,prepared_by,Fatima Saleh
 *   meta,reviewed_by,Laura LaChapelle
 *   meta,review_scope,full
 *   meta,prior_report_id,grand-river-42350-2026-03
 *   revenue,Base Rent,34874.79
 *   expense,Utilities,8557.73
 *   balance,beginningCash,16190.10
 *   balance,netCashFlow,6262.87
 *   balance,endingCash,22452.97
 *   ar,current,455
 *   checks,issued,10060;10061;10062
 *   checks,cleared,10060;10061
 *   checks,outstanding,10062
 *   exec,ytdNOI,-1139.15
 *   exec,occupancyPct,54
 *   exec,narrative,Property listed for sale.
 */

function parseCsvLine(line) {
  // minimal CSV: split on commas but keep the remainder of the line for the value
  const i1 = line.indexOf(',');
  const i2 = line.indexOf(',', i1 + 1);
  if (i1 < 0) return [line.trim()];
  if (i2 < 0) return [line.slice(0, i1).trim(), line.slice(i1 + 1).trim()];
  return [line.slice(0, i1).trim(), line.slice(i1 + 1, i2).trim(), line.slice(i2 + 1).trim()];
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48);
}

function num(v) {
  const n = Number(String(v).replace(/[$,()]/g, (m) => (m === '(' || m === ')' ? '' : '')).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const meta = {};
  const revenue = [];
  const expenses = [];
  const balance = {};
  const ar = {};
  const checks = {};
  const exec = {};

  for (const raw of lines) {
    const [section, label, value] = parseCsvLine(raw);
    const sec = (section || '').toLowerCase();
    if (sec === 'section' || sec === '') continue; // header row
    switch (sec) {
      case 'meta':
        meta[label] = value;
        break;
      case 'revenue':
        revenue.push({ label, amount: num(value) });
        break;
      case 'expense':
      case 'expenses':
        expenses.push({ label, amount: num(value) });
        break;
      case 'balance':
        balance[label] = num(value);
        break;
      case 'ar':
      case 'receivables':
        ar[label] = num(value);
        break;
      case 'checks':
        checks[label] = String(value || '')
          .split(/[;|]/)
          .map((x) => parseInt(x.trim(), 10))
          .filter((x) => Number.isFinite(x));
        break;
      case 'exec':
        exec[label] = label === 'narrative' ? value : isNaN(Number(value)) ? value : Number(value);
        break;
      default:
        break;
    }
  }

  const totalRevenue = revenue.reduce((a, b) => a + b.amount, 0);
  const totalExpenses = expenses.reduce((a, b) => a + b.amount, 0);
  const month = meta.period_month || new Date().toISOString().slice(0, 7);
  const propertyId = meta.property_id || slug(meta.property || 'property');
  const id = meta.report_id || `${propertyId}-${month}`;

  const report = {
    id,
    propertyId,
    property: meta.property || 'Untitled Property',
    division: meta.division || '3rd Party',
    period: { label: meta.period_label || month, month, type: meta.period_type || 'PTD' },
    preparedBy: meta.prepared_by ? { name: meta.prepared_by, role: meta.prepared_role || 'Property Accountant' } : null,
    reviewedBy: meta.reviewed_by ? { name: meta.reviewed_by, role: meta.reviewed_role || 'Property Manager', scope: meta.review_scope || 'full' } : null,
    approvedBy: meta.approved_by ? { name: meta.approved_by, role: meta.approved_role || 'Accounting Supervisor' } : null,
    status: meta.status || 'draft_pending_signoff',
    periodClose: meta.period_close || null,
    preparedDate: meta.prepared_date || null,
    reviewedDate: meta.reviewed_date || null,
    reviewDurationMinutes: meta.review_minutes != null ? Number(meta.review_minutes) : null,
    priorReportId: meta.prior_report_id || null,
    execSummary: {
      ytdNOI: exec.ytdNOI != null ? Number(exec.ytdNOI) : null,
      monthTotalRevenue: totalRevenue,
      monthOperatingExpenses: totalExpenses,
      occupancyPct: exec.occupancyPct != null ? Number(exec.occupancyPct) : null,
      tenants: exec.tenants ? String(exec.tenants).split(';').map((t) => t.trim()) : [],
      narrative: exec.narrative || '',
    },
    incomeStatement: {
      revenue,
      totalRevenue: meta.total_revenue != null ? num(meta.total_revenue) : totalRevenue,
      expenses,
      totalExpenses: meta.total_expenses != null ? num(meta.total_expenses) : totalExpenses,
      noiPTD: meta.noi != null ? num(meta.noi) : totalRevenue - totalExpenses,
    },
    balance: Object.keys(balance).length ? balance : null,
    receivablesAging: Object.keys(ar).length
      ? {
          current: ar.current || 0,
          d0_30: ar.d0_30 || ar['0_30'] || 0,
          d30_60: ar.d30_60 || ar['30_60'] || 0,
          d60_90: ar.d60_90 || ar['60_90'] || 0,
          d90_plus: ar.d90_plus || ar['90_plus'] || 0,
          total: ar.total != null ? ar.total : (ar.current || 0) + (ar.d0_30 || 0) + (ar.d30_60 || 0) + (ar.d60_90 || 0) + (ar.d90_plus || 0),
        }
      : null,
    bankRec: checks.issued ? { checkSequence: { issued: checks.issued, cleared: checks.cleared || [], outstanding: checks.outstanding || [] }, note: meta.bankrec_note || '' } : undefined,
    footnotes: {},
  };

  return report;
}

const CSV_TEMPLATE = `section,label,amount
meta,property,28000 Example Road — Receivership
meta,division,Receivership
meta,period_label,April 1–30 2026
meta,period_month,2026-04
meta,period_type,PTD
meta,prepared_by,Property Accountant
meta,reviewed_by,Property Manager
meta,review_scope,full
meta,period_close,2026-04-30
meta,reviewed_date,2026-05-08
meta,review_minutes,20
meta,prior_report_id,
revenue,Base Rent,34874.79
revenue,Reimbursable Expense Income (CAM/Tax/Insurance),16210.72
expense,General & Administrative,608.56
expense,Utilities,8557.73
expense,Repairs & Maintenance,2935.00
expense,Insurance,2136.00
expense,Real Property Taxes,30000.00
expense,Management Fee,3000.00
balance,beginningCash,16190.10
balance,netCashFlow,6262.87
balance,endingCash,22452.97
ar,current,455
ar,d0_30,0
ar,d30_60,0
ar,d60_90,0
ar,d90_plus,0
checks,issued,10060;10061;10062;10063;10064;10065
checks,cleared,10060;10061;10065
checks,outstanding,
exec,ytdNOI,-1139.15
exec,occupancyPct,54
exec,narrative,Single tenant; vacant suite being leased; building listed for sale.
`;

module.exports = { parseCsv, CSV_TEMPLATE };
