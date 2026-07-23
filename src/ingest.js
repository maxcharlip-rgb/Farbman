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
  // Fast path (no quotes): split on the first two commas, keep the remainder as
  // the value — preserves commas/spacing inside an unquoted value (e.g. a narrative).
  if (line.indexOf('"') < 0) {
    const i1 = line.indexOf(',');
    if (i1 < 0) return [line.trim()];
    const i2 = line.indexOf(',', i1 + 1);
    if (i2 < 0) return [line.slice(0, i1).trim(), line.slice(i1 + 1).trim()];
    return [line.slice(0, i1).trim(), line.slice(i1 + 1, i2).trim(), line.slice(i2 + 1).trim()];
  }
  // Quoted fields present (e.g. a label with a comma: "Reimbursable Income (CAM, Tax)")
  // — use the same quote-aware splitter the roster parser uses, then rejoin any
  // trailing columns as the value so a quoted comma in the label no longer truncates the row.
  const cols = splitCsvRow(line);
  if (cols.length <= 1) return [cols[0] || ''];
  if (cols.length === 2) return [cols[0], cols[1]];
  return [cols[0], cols[1], cols.slice(2).join(',')];
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48);
}

function num(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return 0; // a blank cell is a legitimate zero
  const negative = /^\(.*\)$/.test(s); // accounting negative, e.g. (500.00) → -500
  const cleaned = s.replace(/[$,()\s]/g, '');
  const n = Number(cleaned);
  // Non-empty but non-numeric (e.g. "N/A") → NaN so the arithmetic tie-out surfaces
  // it, instead of silently substituting 0 and "auto-verifying" a wrong total.
  if (!Number.isFinite(n)) return NaN;
  return negative ? -Math.abs(n) : n;
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

  // Reject un-parseable input instead of silently minting an "Untitled Property"
  // junk record: a real report CSV must at least name its property.
  if (!meta.property) {
    throw new Error('could not parse a report — the CSV needs a "meta,property,<name>" row (download the template for the expected shape)');
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
    // Functional owner-rep contact (no personal names) — carried onto the
    // property by upsertReport so the release step works for imported drafts.
    ownerRep: meta.owner_rep || meta.owner_rep_email
      ? { name: meta.owner_rep || 'Owner Representative', org: meta.owner_rep_org || null, email: meta.owner_rep_email || null }
      : null,
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
meta,owner_rep,Asset Manager
meta,owner_rep_org,Lender or Owner LLC
meta,owner_rep_email,assetmanager@owner.example
`;

// A filled, realistic sample that exercises EVERY supported section and field —
// quoted labels with commas, accounting-style negatives, totals overrides, the
// owner-rep contact, tenants list, full AR aging, and a bank-rec note. Three
// review findings are planted on purpose so the first-pass has real work:
//   1. stated total revenue is $100 above the sum of the revenue lines
//   2. checks 2204–2205 are neither cleared nor outstanding
//   3. the bank-rec note contains an unredacted account number
const CSV_SAMPLE = `section,label,amount
meta,property,NAI Farbman as Receiver of 300 Galleria Officentre — Receivership
meta,property_id,galleria-300
meta,division,Receivership
meta,period_label,June 1–30 2026
meta,period_month,2026-06
meta,period_type,PTD
meta,prepared_by,Fatima Saleh
meta,prepared_role,Property Accountant
meta,reviewed_by,Laura LaChapelle
meta,reviewed_role,Property Manager
meta,review_scope,full
meta,status,draft_pending_signoff
meta,period_close,2026-06-30
meta,prepared_date,2026-07-08
meta,reviewed_date,2026-07-11
meta,review_minutes,6
meta,prior_report_id,
meta,owner_rep,Asset Manager
meta,owner_rep_org,Galleria Lending Group (Lender)
meta,owner_rep_email,assetmanager@gallerialending.example
meta,total_revenue,54980.25
meta,total_expenses,31962.50
meta,noi,23017.75
meta,bankrec_note,Deposits in transit recorded 6/30. Nightly sweep to operating account 8814092331 at Comerica.
revenue,Base Rent,41250.00
revenue,"Reimbursable Expense Income (CAM, Tax, Insurance)",12480.25
revenue,Parking Income,1150.00
expense,General & Administrative,1240.10
expense,Utilities,9868.40
expense,Repairs & Maintenance,4395.00
expense,Insurance,2410.00
expense,Real Property Taxes,12500.00
expense,Management Fee,2749.00
expense,Real Estate Tax Refund,(1200.00)
balance,beginningCash,48300.00
balance,netCashFlow,23017.75
balance,endingCash,71317.75
ar,current,2150.00
ar,d0_30,890.00
ar,d30_60,0
ar,d60_90,0
ar,d90_plus,445.50
ar,total,3485.50
checks,issued,2201;2202;2203;2204;2205;2206
checks,cleared,2201;2202;2206
checks,outstanding,2203
exec,ytdNOI,96412.30
exec,occupancyPct,91
exec,tenants,Sterling Legal Group;Oakwood Dental;Motor City Analytics;3 others
exec,narrative,Occupancy steady at 91%; two suites under LOI for Q3 move-in. Receiver continues marketing the remaining vacancy.
`;

// ── Monthly property list parsing (roster sync) ────────────────────────────
// A wide CSV: code,name,division,owner_rep,owner_rep_email — header row is
// used to locate columns, so column order is flexible. Handles quoted fields
// (property names may contain commas).
function splitCsvRow(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parsePropertyList(text) {
  const rows = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!rows.length) return [];
  const header = splitCsvRow(rows[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  const idx = (names) => {
    for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const ci = { code: idx(['code', 'property_code', 'prop_code']), name: idx(['name', 'property', 'property_name']),
    division: idx(['division', 'div', 'portfolio']), rep: idx(['owner_rep', 'owner_representative', 'rep', 'owner']),
    email: idx(['owner_rep_email', 'rep_email', 'email', 'owner_email']) };
  const hasHeader = ci.code >= 0 || ci.name >= 0;
  const start = hasHeader ? 1 : 0;
  const out = [];
  for (let r = start; r < rows.length; r++) {
    const cols = splitCsvRow(rows[r]);
    const code = (ci.code >= 0 ? cols[ci.code] : cols[0]) || '';
    const name = (ci.name >= 0 ? cols[ci.name] : cols[1]) || '';
    if (!code && !name) continue;
    const division = (ci.division >= 0 ? cols[ci.division] : cols[2]) || '3rd Party';
    const repName = ci.rep >= 0 ? cols[ci.rep] : '';
    const repEmail = ci.email >= 0 ? cols[ci.email] : '';
    out.push({
      id: slug(name || code),
      code: code.trim(),
      name: name.trim() || code.trim(),
      division: division.trim() || '3rd Party',
      ownerRep: repName || repEmail ? { name: repName.trim(), email: repEmail.trim() } : null,
    });
  }
  return out;
}

module.exports = { parseCsv, CSV_TEMPLATE, CSV_SAMPLE, parsePropertyList };
