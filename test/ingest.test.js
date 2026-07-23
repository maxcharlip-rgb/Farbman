'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseCsv, parsePropertyList, CSV_SAMPLE } = require('../src/ingest');

const base = ['section,label,amount', 'meta,property,Test Prop', 'meta,period_month,2026-04'];

test('accounting negative in parentheses parses as negative (not positive)', () => {
  const r = parseCsv([...base, 'expense,Adjustment,(500.00)'].join('\n'));
  const adj = r.incomeStatement.expenses.find((e) => e.label === 'Adjustment');
  assert.strictEqual(adj.amount, -500);
});

test('a plain negative and a $ / comma amount both parse correctly', () => {
  const r = parseCsv([...base, 'balance,netCashFlow,-1139.15', 'revenue,Base Rent,"$34,874.79"'].join('\n'));
  assert.strictEqual(r.balance.netCashFlow, -1139.15);
  assert.strictEqual(r.incomeStatement.revenue[0].amount, 34874.79);
});

test('quoted label containing a comma is not truncated', () => {
  const r = parseCsv([...base, 'revenue,"Reimbursable Income (CAM, Tax, Insurance)",16210.72'].join('\n'));
  const rev = r.incomeStatement.revenue[0];
  assert.strictEqual(rev.label, 'Reimbursable Income (CAM, Tax, Insurance)');
  assert.strictEqual(rev.amount, 16210.72);
});

test('a non-numeric amount surfaces as NaN, not a silent 0', () => {
  const r = parseCsv([...base, 'revenue,Base Rent,N/A'].join('\n'));
  assert.ok(Number.isNaN(r.incomeStatement.revenue[0].amount));
});

test('garbage CSV is rejected instead of minting an "Untitled Property"', () => {
  assert.throws(() => parseCsv('asdf,qwer,zxcv\nfoo,bar,baz'));
});

test('property list round-trips and handles a quoted comma in the name', () => {
  const list = parsePropertyList(['code,name,division', 'GR1,"42350 Grand River, Detroit",Receivership'].join('\n'));
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].code, 'GR1');
  assert.strictEqual(list[0].name, '42350 Grand River, Detroit');
  assert.strictEqual(list[0].division, 'Receivership');
});

test('the filled sample parses with every section and carries the owner rep', () => {
  const r = parseCsv(CSV_SAMPLE);
  assert.strictEqual(r.propertyId, 'galleria-300');
  assert.strictEqual(r.division, 'Receivership');
  // owner rep rides in as a functional contact (no personal name)
  assert.deepStrictEqual(r.ownerRep, {
    name: 'Asset Manager', org: 'Galleria Lending Group (Lender)', email: 'assetmanager@gallerialending.example',
  });
  // planted: stated total is $100 above the line sum — must be preserved for the engine
  const lineSum = r.incomeStatement.revenue.reduce((a, b) => a + b.amount, 0);
  assert.strictEqual(Math.round((r.incomeStatement.totalRevenue - lineSum) * 100), 10000);
  // accounting negative parsed
  assert.strictEqual(r.incomeStatement.expenses.find((e) => e.label === 'Real Estate Tax Refund').amount, -1200);
  // quoted label with commas intact
  assert.ok(r.incomeStatement.revenue.some((x) => x.label === 'Reimbursable Expense Income (CAM, Tax, Insurance)'));
  // checks + aging + tenants all present
  assert.strictEqual(r.bankRec.checkSequence.issued.length, 6);
  assert.strictEqual(r.receivablesAging.total, 3485.5);
  assert.strictEqual(r.execSummary.tenants.length, 4);
});
