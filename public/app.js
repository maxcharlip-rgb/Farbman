'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let ROLE = localStorage.getItem('farbman_role') || 'Reviewer';

async function api(path, opts = {}) {
  // The role rides on a header so GET reads (portfolio, property) are gated by
  // signee too, not just the POST actions.
  const o = { ...opts, headers: { 'content-type': 'application/json', 'x-role': ROLE, ...(opts.headers || {}) } };
  if (o.body && typeof o.body === 'object') {
    o.body = JSON.stringify({ ...o.body, role: ROLE });
  }
  const res = await fetch(path, o);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data });
  return data;
}

// ── Router ─────────────────────────────────────────────
const routes = [
  [/^#\/$/, renderPortfolio],
  [/^#\/property\/(.+)$/, renderProperty],
  [/^#\/chat$/, renderChat],
  [/^#\/calibration$/, renderCalibration],
  [/^#\/audit$/, renderAudit],
  [/^#\/sync$/, renderSync],
  [/^#\/import$/, renderImport],
];

function router() {
  const hash = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      setActiveNav(hash);
      fn(...m.slice(1)).catch((e) => ($('#view').innerHTML = errorBox(e.message)));
      return;
    }
  }
  location.hash = '#/';
}
function setActiveNav(hash) {
  const key = hash === '#/' ? 'portfolio' : hash.replace('#/', '').split('/')[0];
  $$('.mainnav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
}
function errorBox(msg) {
  return `<div class="panel"><div class="empty">⚠ ${esc(msg)}</div></div>`;
}

// ── Portfolio dashboard ────────────────────────────────
let PORTFOLIO_FILTER = 'All';
async function renderPortfolio() {
  const data = await api('/api/portfolio');
  const props = data.properties;
  const divisions = ['All', ...Object.keys(data.divisionCounts)];

  const agg = {
    total: props.length,
    reviewed: props.filter((p) => p.status.state !== 'not_run').length,
    ready: props.filter((p) => p.status.state === 'ready').length,
    signed: props.filter((p) => p.status.state === 'signed_off').length,
    secondOpinion: props.reduce((a, p) => a + (p.summary ? p.summary.counts.escalate : 0), 0),
    exceptions: props.reduce((a, p) => a + (p.summary ? p.summary.exceptions : 0), 0),
  };

  const shown = props.filter((p) => PORTFOLIO_FILTER === 'All' || p.division === PORTFOLIO_FILTER);

  const stat = (n, l, cls = '') => `<div class="kpi ${cls}"><div class="n">${n}</div><div class="l">${l}</div></div>`;

  const rows = shown
    .map((p) => {
      const s = p.status;
      const sum = p.summary;
      const badge = `<span class="state state-${s.state}">${esc(s.label)}</span>` +
        (p.submitted ? ` <span class="submit-tag" title="You submitted your review">✓ submitted</span>` : '');
      const counts = sum
        ? `<div class="minicounts">` +
          chipN(sum.verified, 'ok', '✓') +
          chipN(sum.exceptions, 'bad', '✗') +
          chipN(sum.counts.flag, 'warn', 'flag') +
          chipN(sum.counts.escalate, 'esc', '2nd') +
          `</div>`
        : `<span class="muted">—</span>`;
      const inactive = p.rosterStatus === 'inactive';
      const sub = `${p.code ? esc(p.code) + ' · ' : ''}${p.period ? esc(p.period.label) : 'Awaiting first report'}`;
      return `<tr data-href="#/property/${esc(p.id)}" class="${inactive ? 'row-inactive' : ''}">
        <td><div class="pname">${esc(p.name)}${inactive ? ' <span class="inactive-tag">inactive</span>' : ''}</div><div class="muted sm">${sub}</div></td>
        <td><span class="divtag">${esc(p.division)}</span></td>
        <td>${badge}</td>
        <td>${counts}</td>
        <td class="go">→</td>
      </tr>`;
    })
    .join('');

  $('#view').innerHTML = `
    <div class="kpis">
      ${stat(agg.total, 'Properties')}
      ${stat(agg.reviewed + '/' + agg.total, 'First-pass run')}
      ${stat(agg.ready, 'Ready to sign', agg.ready ? 'good' : '')}
      ${stat(agg.signed, 'Signed off', 'good')}
      ${stat(agg.exceptions, 'Open exceptions', agg.exceptions ? 'bad' : '')}
      ${stat(agg.secondOpinion, 'Second-opinion items', agg.secondOpinion ? 'esc' : '')}
    </div>
    <div class="panel">
      <div class="panel-head">
        <h2>Portfolio</h2>
        <div class="divfilter">${divisions
          .map((d) => `<button class="dpill ${d === PORTFOLIO_FILTER ? 'on' : ''}" data-div="${esc(d)}">${esc(d)}${d !== 'All' ? ` <b>${data.divisionCounts[d]}</b>` : ''}</button>`)
          .join('')}</div>
      </div>
      ${PORTFOLIO_FILTER !== 'All' && data.divisionBlurbs && data.divisionBlurbs[PORTFOLIO_FILTER]
        ? `<p class="divblurb">${esc(data.divisionBlurbs[PORTFOLIO_FILTER])}</p>` : ''}
      <div class="tscroll"><table class="grid">
        <thead><tr><th>Property</th><th>Division</th><th>Status</th><th>First-pass result</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="empty">No properties in this division.</td></tr>`}</tbody>
      </table></div>
    </div>`;

  $$('.dpill').forEach((b) => (b.onclick = () => { PORTFOLIO_FILTER = b.dataset.div; renderPortfolio(); }));
  $$('tr[data-href]').forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
}
function chipN(n, cls, label) {
  return `<span class="mc mc-${cls}" title="${label}">${n}</span>`;
}

// ── Property workspace ─────────────────────────────────
async function renderProperty(id) {
  const [d, trend] = await Promise.all([
    api('/api/property/' + id),
    api('/api/trend/' + id).catch(() => null),
  ]);
  const { property, report, review } = d;
  // Owner rep before release: the package hasn't been handed to them yet.
  if (d.notReleased) {
    $('#view').innerHTML = `
      <a class="back" href="#/">← Portfolio</a>
      <div class="panel" style="text-align:center;padding:42px 24px;">
        <h2 class="rname">${esc(property.name)}</h2>
        <div class="muted sm">${esc(property.division)}${property.code ? ' · ' + esc(property.code) : ''}</div>
        <p class="muted" style="max-width:520px;margin:14px auto 0;">This report hasn't been released to you yet.
        It appears here — reviewed and signed off — once the team sends it.</p>
      </div>`;
    return;
  }
  if (!report) return ($('#view').innerHTML = errorBox('Report not found'));

  // The owner rep receives a read-only package; every internal role runs their
  // own AI-assisted pass and dispositions into their own private draft.
  const canDispo = !!d.canDispose;
  const disp = d.dispositions || { mine: {}, others: {}, submittedByMe: false, submittedRoles: [] };

  $('#view').innerHTML = `
    <a class="back" href="#/">← Portfolio</a>
    <div class="workspace">
      <section class="panel report-panel">
        <div class="report-head">
          <div>
            <div class="muted sm">${esc(property.division)} · ${esc(report.period.label)}</div>
            <h2 class="rname">${esc(report.property)}</h2>
            <div class="muted sm">Prepared by ${esc(report.preparedBy ? report.preparedBy.name : '—')}${report.reviewedBy ? ' · Reviewed by ' + esc(report.reviewedBy.name) : ''}</div>
          </div>
          <div class="report-head-right">
            <span class="status ${d.sent || d.signoff ? 'signed_off' : 'draft'}">${d.sent ? 'released to owner rep' : d.signoff ? 'signed off' : esc((report.status || '').replace(/_/g, ' '))}</span>
            <a class="run-btn ghost export-btn" href="/api/export/${esc(property.id)}?role=${encodeURIComponent(ROLE)}" download title="Download this report as a Word document you can edit and send out">⤓ Export Word</a>
          </div>
        </div>
        <div class="draft-note">${canDispo
          ? `You're reviewing as <strong>${esc(roleLabel(ROLE))}</strong>. Your dispositions are private until you submit. · Sample data, prototype demo only.`
          : `Delivered to you as <strong>${esc(roleLabel(ROLE))}</strong> — read-only. · Sample data, prototype demo only.`}</div>
        <div id="reportView" class="report-view"></div>
        <div id="trendView"></div>
      </section>

      <section class="panel findings-panel">
        ${review ? '' : canDispo
          ? `<div class="run-cta"><p>This draft hasn't had a first-pass review yet.</p><button id="runBtn" class="run-btn">Run first-pass review</button></div>`
          : `<div class="run-cta"><p class="muted">No first-pass review yet — an internal reviewer runs it before this reaches you.</p></div>`}
        <div id="signoffBar"></div>
        <div id="summary"></div>
        <div id="briefing" class="briefing hidden"></div>
        <div id="findings"></div>
        <div id="submitBar"></div>
        <div id="auditTrail"></div>
        <div id="sendBar"></div>
      </section>
    </div>`;

  renderReport(report);
  renderTrend(trend);

  if ($('#runBtn')) $('#runBtn').onclick = () => runReview(property.id);
  if (review) {
    renderSignoffBar(d);
    renderSummary(review.summary);
    renderFindings(review, disp, report.id, canDispo);
    renderSubmitBar(d, disp);
    renderAuditTrail(d.audit);
    loadBriefing(property.id);
  }
  renderSendBar(d);
}

// ── Submit bar: publish your private pass to the team ──
function renderSubmitBar(d, disp) {
  const el = $('#submitBar');
  if (!el) return;
  if (!d.canDispose) { el.innerHTML = ''; return; } // owner rep has no pass to submit
  const others = (disp.submittedRoles || []).map((r) => roleLabel(r.role));
  const alsoSubmitted = others.length ? `<div class="muted sm">Also submitted: ${others.map(esc).join(', ')}.</div>` : '';
  const mineCount = Object.keys(disp.mine || {}).length;

  if (disp.submittedByMe) {
    el.className = 'submit-bar done';
    el.innerHTML = `<div><strong>✓ You submitted your review</strong> <span class="muted sm">· ${fmtTime(disp.submittedByMeAt)}. Your dispositions are now visible to the team; further changes show immediately.</span></div>${alsoSubmitted}`;
    return;
  }
  el.className = 'submit-bar ready';
  el.innerHTML = `<div><strong>Your review is a private draft.</strong> <span class="muted sm">${mineCount} finding${mineCount === 1 ? '' : 's'} dispositioned — nobody else sees them until you submit.</span>${alsoSubmitted}</div>
    <button class="run-btn" id="submitBtn">Submit my review</button>`;
  $('#submitBtn').onclick = async () => {
    try {
      await api('/api/submit', { method: 'POST', body: { reportId: d.report.id } });
      launchBalloons({ count: 12 });
      renderProperty(d.property.id);
    } catch (e) { alert(e.message); }
  };
}

// ── Release to the owner representative (the end of the workflow) ──
function renderSendBar(d) {
  const el = $('#sendBar');
  if (!el) return;
  const { property, signoff, sent } = d;
  const rep = d.ownerRep || property.ownerRep;
  if (!rep) { el.innerHTML = ''; return; }

  const repCard = `<div class="rep-card">
      <div class="rep-label">Owner representative</div>
      <div class="rep-name">${esc(rep.name)}${rep.title ? ` <span class="muted sm">· ${esc(rep.title)}</span>` : ''}</div>
      <div class="muted sm">${esc(rep.org || '')}${rep.email ? ` · ${esc(rep.email)}` : ''}</div>
    </div>`;

  // The owner rep's own view: they receive the package, they don't release it.
  if (ROLE === 'Owner Representative') {
    el.className = 'send-bar ' + (sent ? 'done' : 'blocked');
    el.innerHTML = repCard + (sent
      ? `<div class="sent-note"><strong>✓ Delivered to you</strong> — released by ${esc(sent.by)} · ${fmtTime(sent.at)}. This is the reviewed, signed-off package.</div>`
      : `<div class="sent-note muted">This report hasn't been released to you yet — it appears here once the team signs off and sends it.</div>`);
    return;
  }

  if (sent) {
    el.className = 'send-bar done';
    el.innerHTML = repCard +
      `<div class="sent-note"><strong>✓ Sent to ${esc(rep.name)}</strong> (${esc(rep.email)}) — released by ${esc(sent.by)} · ${fmtTime(sent.at)}</div>` +
      `<button class="run-btn ghost" id="resendBtn">Resend</button>`;
    $('#resendBtn').onclick = () => doSend(property.id, rep);
    return;
  }

  if (!signoff) {
    el.className = 'send-bar blocked';
    el.innerHTML = repCard +
      `<div class="sent-note muted">Sign off the report before releasing it to the owner representative.</div>` +
      `<button class="run-btn ghost" disabled>Send to owner representative</button>`;
    return;
  }

  el.className = 'send-bar ready';
  el.innerHTML = repCard +
    `<div class="sent-note">Reviewed and signed off — ready to release.</div>` +
    `<button class="run-btn" id="sendBtn">Send to owner representative</button>`;
  $('#sendBtn').onclick = () => doSend(property.id, rep);
}

async function doSend(propertyId, rep) {
  // One click releases it (prototype: records the release in the audit trail; no real email).
  try {
    await api('/api/send-to-owner', { method: 'POST', body: { propertyId } });
    launchBalloons({ count: 20, goldBias: true });
    renderProperty(propertyId);
  } catch (e) { alert(e.message); }
}

// ── Multi-month trend (most useful for receivership per asset mgmt) ──
function spark(vals) {
  const pts = vals.filter((v) => v != null);
  if (pts.length < 2) return '';
  const w = 120, h = 26, pad = 3;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const xs = vals.map((v, i) => (vals.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (vals.length - 1)));
  const ys = vals.map((v) => (v == null ? null : h - pad - ((v - min) / span) * (h - 2 * pad)));
  const line = vals.map((v, i) => (v == null ? null : `${xs[i].toFixed(1)},${ys[i].toFixed(1)}`)).filter(Boolean).join(' ');
  const lastIdx = vals.length - 1;
  const dot = ys[lastIdx] == null ? '' : `<circle cx="${xs[lastIdx].toFixed(1)}" cy="${ys[lastIdx].toFixed(1)}" r="2.5" fill="var(--accent)"/>`;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>${dot}</svg>`;
}
const kfmt = (v) => (v == null ? '—' : (v < 0 ? '-' : '') + '$' + (Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + 'k' : Math.abs(v).toFixed(0)));

function renderTrend(t) {
  const el = $('#trendView');
  if (!el) return;
  if (!t || !t.points || t.points.length < 2) { el.innerHTML = ''; return; }
  const P = t.points;
  const monthLabel = (m) => new Date(m + '-15').toLocaleString('en-US', { month: 'short' });
  const metric = (label, key, fmt) => {
    const vals = P.map((p) => p[key]);
    if (vals.every((v) => v == null)) return '';
    return `<tr><td class="tlabel">${label}</td><td class="tspark">${spark(vals)}</td>${vals.map((v) => `<td class="amt">${fmt(v)}</td>`).join('')}</tr>`;
  };
  el.innerHTML = `
    <h3>Trend — last ${P.length} periods</h3>
    <p class="muted sm">Reporting is cumulative: a prior-month error propagates until caught. The trend is where it surfaces.</p>
    <div class="tscroll"><table class="fin trend">
      <thead><tr><th></th><th></th>${P.map((p) => `<th class="amt">${monthLabel(p.month)}</th>`).join('')}</tr></thead>
      <tbody>
        ${metric('NOI (period)', 'noi', kfmt)}
        ${metric('YTD NOI', 'ytdNOI', kfmt)}
        ${metric('Revenue', 'revenue', kfmt)}
        ${metric('Expenses', 'expenses', kfmt)}
        ${metric('Ending cash', 'endingCash', kfmt)}
        ${metric('Occupancy', 'occupancyPct', (v) => (v == null ? '—' : v + '%'))}
      </tbody>
    </table></div>`;
}

// ── The company's Monthly Financial Report format (per the FG Ohio exemplar):
// numbered sections — Executive Summary (overview, financial highlights,
// operational items) → Financial Statements (income, budget comparison,
// variance analytics, cash flow) → AR → Bank Reconciliation.
function monthName(p) {
  try { return new Date(p.month + '-15').toLocaleString('en-US', { month: 'long', year: 'numeric' }); }
  catch { return p.label || ''; }
}
function moneyParen(n) { return n < 0 ? '($' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ')' : money(n); }

// The three standard Financial Highlights paragraphs, in the company's exact language.
function financialHighlights(r) {
  const es = r.execSummary || {};
  const m = monthName(r.period);
  const year = (r.period.month || '').slice(0, 4);
  const out = [];
  if (r.balance && r.balance.endingCash != null) out.push(`As of ${m} the ending cash balance is: ${money(r.balance.endingCash)}.`);
  if (es.monthTotalRevenue != null && es.monthRevenueVarianceToBudget != null) {
    const v = es.monthRevenueVarianceToBudget, b = es.monthTotalRevenue - v;
    out.push(`The ${m} Total Revenue was ${money(es.monthTotalRevenue)}. This reflects ${v >= 0 ? 'a favorable variance of ' + money(v) : 'an unfavorable variance of ' + moneyParen(v)} as it relates to the total revenue projection within the ${year} budget of ${money(b)}. See variance report for details.`);
  }
  if (es.monthOperatingExpenses != null && es.monthExpenseVarianceToBudget != null) {
    const v = es.monthExpenseVarianceToBudget, b = es.monthOperatingExpenses - v; // over budget = unfavorable
    out.push(`The ${m} Operating Expenses were ${money(es.monthOperatingExpenses)}. This reflects ${v <= 0 ? 'a favorable variance of ' + money(-v) : 'an unfavorable variance of ' + moneyParen(-v)} as it relates to the expense projection within the ${year} budget of ${money(b)}. See variance report for details.`);
  }
  if (es.ytdNOI != null && es.ytdNOIVarianceToBudget != null) {
    const v = es.ytdNOIVarianceToBudget, b = es.ytdNOI - v;
    out.push(`The Year-to-Date Net Operating Income through ${m} is ${money(es.ytdNOI)}. This reflects ${v >= 0 ? 'a favorable variance of ' + money(v) : 'an unfavorable variance of ' + moneyParen(v)} as it relates to the Year-to-Date Net Operating Income projections within the ${year} budget of ${money(b)}. See variance report for details.`);
  }
  return out;
}

const OPERATIONAL_ORDER = [
  ['receivershipOath', 'Receivership Oath'], ['suretyBond', 'Surety Bond'], ['filingOfInventory', 'Filing of Inventory'],
  ['leasingActivity', 'Leasing Activity'], ['salesActivity', 'Sales Activity'], ['marketingActivity', 'Marketing Activity'],
  ['significantTenantIssues', 'Significant Tenant Issues'], ['operationalIssues', 'Operational Issues'],
  ['capitalProjects', 'Capital Projects'], ['realEstateTaxes', 'Real Estate Taxes'], ['insurance', 'Insurance'],
  ['legal', 'Legal'], ['receivershipFees', 'Receivership Fees'], ['protectiveAdvances', 'Protective Advances'],
];

// Balance Sheet, derived so Assets always tie to Capital (cash-basis receivership
// books): Assets = ending cash + AR; Capital = owner/lender contributions to the
// estate + retained earnings (cumulative NOI). Ties by construction.
function balanceSheetOf(r) {
  if (!r.balance || r.balance.endingCash == null) return null;
  const cash = r.balance.endingCash;
  const arTotal = (r.receivablesAging && r.receivablesAging.total) || 0;
  const totalAssets = cash + arTotal;
  const retained = (r.execSummary && r.execSummary.ytdNOI != null)
    ? r.execSummary.ytdNOI
    : ((r.incomeStatement && r.incomeStatement.noiPTD) || 0);
  return { cash, arTotal, totalAssets, retained, contribution: totalAssets - retained };
}

function renderReport(r) {
  const is = r.incomeStatement || {};
  const row = (label, amt, opt = {}) =>
    `<tr class="${opt.total ? 'total' : ''}"><td>${esc(label)}${opt.fn ? `<span class="fn">${opt.fn}</span>` : ''}</td><td class="amt ${amt < 0 ? 'neg' : ''}">${money(amt)}</td></tr>`;
  const es = r.execSummary || {};
  const ar = r.receivablesAging;
  const code = r.propertyId || '';
  const finFooter = (name) => `<div class="yfoot">${esc(r.property)}${code ? ' (' + esc(code) + ')' : ''} · ${esc(name)} · Period = ${esc(monthName(r.period))} · Book = Cash</div>`;
  let h = `<div class="rep-cover"><div class="rep-cover-t">Monthly Financial Report</div><div class="rep-cover-m">${esc(monthName(r.period))}</div></div>`;

  // ── 1. Executive Summary ──
  h += `<h3><span class="secnum">1.</span> Executive Summary</h3>`;
  const ov = r.overview;
  if (ov) {
    const kv = [
      ['Property', r.property], ['Address', ov.address], ['Property Type', ov.propertyType],
      ['Year Built', ov.yearBuilt], ['Rentable Sq Feet', ov.rentableSqFt != null ? Number(ov.rentableSqFt).toLocaleString('en-US') : null],
      ['Parking', ov.parking], ['Occupancy', es.occupancyPct != null ? es.occupancyPct + '%' : null],
      ['Date Appointed', ov.dateAppointed], ['Court', ov.court], ['Judge', ov.judge], ['Case Number', ov.caseNumber],
      ['Receiver', ov.receiver], ["Receiver's Counsel", ov.receiversCounsel], ['Plaintiff', ov.plaintiff], ['Defendant', ov.defendant],
      ['Managed By', ov.managedBy], ['Property Manager', r.reviewedBy ? r.reviewedBy.name : null], ['Property Accountant', r.preparedBy ? r.preparedBy.name : null],
    ].filter(([, v]) => v != null && v !== '');
    h += `<h4 class="subhead">Property Overview</h4><div class="ovgrid">` +
      kv.map(([k, v]) => `<div class="ovk">${esc(k)}:</div><div class="ovv">${esc(v)}</div>`).join('') + `</div>`;
  }
  const highlights = financialHighlights(r);
  if (highlights.length) {
    h += `<h4 class="subhead">Financial Highlights</h4>` + highlights.map((p) => `<p class="exec">${esc(p)}</p>`).join('');
  } else if (es.narrative) {
    h += `<p class="exec">${esc(es.narrative)}</p>`;
  }
  if (r.operational) {
    for (const [key, label] of OPERATIONAL_ORDER) {
      if (!r.operational[key]) continue;
      h += `<div class="opline"><span class="opk">${esc(label)}:</span> ${esc(r.operational[key])}</div>`;
    }
  }
  if (es.narrative && highlights.length) h += `<div class="opline"><span class="opk">Status:</span> ${esc(es.narrative)}</div>`;

  // ── 2. Financial Statements ──
  h += `<h3><span class="secnum">2.</span> Financial Statements</h3>`;

  // Balance Sheet — leads the section in the company's format; ties by construction.
  const bs = balanceSheetOf(r);
  if (bs) {
    const bsRow = (label, amt, ind) => `<tr><td class="${ind ? 'ind' : ''}">${esc(label)}</td><td class="amt ${amt < 0 ? 'neg' : ''}">${money(amt)}</td></tr>`;
    h += `<h4 class="subhead">Balance Sheet</h4><table class="fin">`;
    h += `<tr class="grp"><td colspan="2">Assets</td></tr>`;
    h += bsRow('Operating Cash', bs.cash, true);
    if (bs.arTotal) h += bsRow('Accounts Receivable', bs.arTotal, true);
    h += row('TOTAL ASSETS', bs.totalAssets, { total: true });
    h += `<tr class="grp"><td colspan="2">Liabilities and Capital</td></tr>`;
    h += bsRow('Owner / Lender Contribution', bs.contribution, true);
    h += bsRow('Retained Earnings', bs.retained, true);
    h += row('TOTAL LIABILITIES AND CAPITAL', bs.totalAssets, { total: true });
    h += `</table>` + finFooter('Balance Sheet');
  }

  h += `<h4 class="subhead">Income Statement</h4><table class="fin">`;
  h += `<tr class="colhead"><td></td><td class="amt">Period to Date</td></tr>`;
  (is.revenue || []).forEach((l) => (h += row(l.label, l.amount, { fn: l.footnote })));
  h += row('TOTAL REVENUE', is.totalRevenue, { total: true });
  (is.expenses || []).forEach((l) => (h += row(l.label, l.amount, { fn: l.footnote })));
  h += row('TOTAL EXPENSES', is.totalExpenses, { total: true });
  h += row('NET OPERATING INCOME', is.noiPTD, { total: true });
  h += `</table>` + finFooter('Income Statement');

  // Budget Comparison — Actual | Budget | Variance | % Var (from the exec-summary variances)
  const bc = [];
  if (es.monthTotalRevenue != null && es.monthRevenueVarianceToBudget != null)
    bc.push(['Total Revenue', es.monthTotalRevenue, es.monthTotalRevenue - es.monthRevenueVarianceToBudget, es.monthRevenueVarianceToBudget]);
  if (es.monthOperatingExpenses != null && es.monthExpenseVarianceToBudget != null)
    bc.push(['Total Expenses', es.monthOperatingExpenses, es.monthOperatingExpenses - es.monthExpenseVarianceToBudget, -es.monthExpenseVarianceToBudget]);
  if (es.ytdNOI != null && es.ytdNOIVarianceToBudget != null)
    bc.push(['YTD Net Operating Income', es.ytdNOI, es.ytdNOI - es.ytdNOIVarianceToBudget, es.ytdNOIVarianceToBudget]);
  if (bc.length) {
    h += `<h4 class="subhead">Budget Comparison</h4><table class="fin bc"><tr class="colhead"><td></td><td class="amt">Actual</td><td class="amt">Budget</td><td class="amt">Variance</td><td class="amt">% Var</td></tr>`;
    for (const [label, act, bud, vr] of bc) {
      const pct = bud ? (vr / Math.abs(bud)) * 100 : null;
      h += `<tr><td>${esc(label)}</td><td class="amt">${money(act)}</td><td class="amt">${money(bud)}</td><td class="amt ${vr < 0 ? 'neg' : ''}">${moneyParen(vr)}</td><td class="amt ${vr < 0 ? 'neg' : ''}">${pct == null ? 'N/A' : pct.toFixed(1) + '%'}</td></tr>`;
    }
    h += `</table>` + finFooter('Budget Comparison');
  }

  // Variance Analytics — the budget-variance narrative belongs here per the format.
  const bv = r.narrative && r.narrative.budgetVariance;
  if (bv && (bv.revisedText || bv.text)) {
    h += `<h4 class="subhead">Variance Analytics</h4><p class="exec">${esc(bv.revisedText || bv.text)}</p>`;
  }

  if (r.balance) {
    h += `<h4 class="subhead">Cash Flow</h4><table class="fin">`;
    h += row('Beginning Cash', r.balance.beginningCash);
    h += row('Net Cash Flow (Period)', r.balance.netCashFlow);
    h += row('ENDING CASH', r.balance.endingCash, { total: true });
    h += `</table>` + finFooter('Cash Flow Statement');
  }

  // ── 4. Accounts Receivable ── (3. Tenancy is inserted when applicable)
  if (ar) {
    h += `<h3><span class="secnum">4.</span> Accounts Receivable</h3><table class="fin">`;
    h += `<tr class="colhead"><td></td><td class="amt">Owed</td></tr>`;
    h += row('Current', ar.current) + row('0–30 Days', ar.d0_30) + row('31–60 Days', ar.d30_60) + row('61–90 Days', ar.d60_90) + row('Over 90', ar.d90_plus) + row('TOTAL', ar.total, { total: true });
    h += `</table>` + finFooter('Aging Status');
    const arn = r.narrative && r.narrative.arNotes;
    if (arn && (arn.revisedText || arn.text)) h += `<div class="opline"><span class="opk">AR Notes:</span> ${esc(arn.revisedText || arn.text)}</div>`;
  }

  // ── 5. Bank Reconciliation ──
  if (r.bankRec) {
    h += `<h3><span class="secnum">5.</span> Bank Reconciliation</h3>`;
    const cs = r.bankRec.checkSequence;
    if (cs) {
      h += `<table class="fin">`;
      h += `<tr><td>Checks issued</td><td class="amt">${(cs.issued || []).length ? cs.issued[0] + '–' + cs.issued[cs.issued.length - 1] : '—'}</td></tr>`;
      h += `<tr><td>Cleared checks</td><td class="amt">${(cs.cleared || []).join(', ') || '—'}</td></tr>`;
      h += `<tr><td>Outstanding checks</td><td class="amt">${(cs.outstanding || []).join(', ') || 'None'}</td></tr>`;
      if (r.balance) h += `<tr class="total"><td>Reconciled Balance per G/L</td><td class="amt">${money(r.balance.endingCash)}</td></tr>`;
      h += `</table>`;
    }
    if (r.bankRec.note) h += `<div class="note-line"><strong>Bank rec note:</strong> ${esc(r.bankRec.note)}</div>`;
    h += finFooter('Bank Reconciliation Report');
  }

  // Any narrative sections not already placed above
  for (const [key, sec] of Object.entries(r.narrative || {})) {
    if (key === 'budgetVariance' || key === 'arNotes') continue;
    const text = sec.revisedText || sec.text;
    if (!text) continue;
    h += `<h4 class="subhead">${esc(sec.title)}</h4><p class="exec">${esc(text)}</p>`;
  }
  if (r.footnotes) h += Object.entries(r.footnotes).map(([k, v]) => `<div class="note-line"><span class="fn">${esc(k)}</span> ${esc(v)}</div>`).join('');
  $('#reportView').innerHTML = h;
}

async function runReview(propertyId) {
  const btn = $('#runBtn');
  if (btn) { btn.classList.add('loading'); btn.disabled = true; }
  try {
    await api('/api/review', { method: 'POST', body: { propertyId } });
    renderProperty(propertyId); // re-render with results
  } catch (e) {
    $('#findings').innerHTML = errorBox(e.message);
  }
}

function renderSummary(s) {
  $('#summary').innerHTML =
    `<p class="headline">${esc(s.headline)}</p>` +
    `<div class="tier-counts">` +
    tc('verified', s.verified, 'Auto-verified') +
    tc('exception', s.exceptions, 'Deterministic exceptions') +
    tc('flag', s.counts.flag, 'To confirm') +
    tc('escalate', s.counts.escalate, 'Second opinion') +
    `</div><p class="disclaimer">${esc(s.disclaimer)}</p>`;
}
function tc(cls, n, label) { return `<div class="tc ${cls}"><div class="n">${n}</div><div class="l">${label}</div></div>`; }

const SEV_RANK = { high: 0, medium: 1, low: 2, info: 3 };
function renderFindings(review, disp, reportId, canDispo) {
  const groups = { assert: [], flag: [], escalate: [] };
  review.findings.forEach((f) => groups[f.tier].push(f));
  const sorter = (a, b) => (a.passed === false ? 0 : 1) - (b.passed === false ? 0 : 1) || (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9);
  Object.values(groups).forEach((g) => g.sort(sorter));
  const t = review.summary.tiers;
  $('#findings').innerHTML =
    tierGroup('assert', 'Deterministic — verified or certain', t.assert.blurb, groups.assert, disp, canDispo) +
    tierGroup('flag', 'Flag for reviewer', t.flag.blurb, groups.flag, disp, canDispo) +
    tierGroup('escalate', 'Second opinion required', t.escalate.blurb, groups.escalate, disp, canDispo);
  if (canDispo) wireFindingActions(reportId);
}

function tierGroup(tier, label, blurb, items, disp, canDispo) {
  if (!items.length) return '';
  const mine = disp.mine || {};
  const others = disp.others || {};
  return `<div class="tier-group"><h3><span class="dot ${tier}"></span>${esc(label)} <span class="blurb">· ${esc(blurb)}</span></h3>` +
    items.map((f) => card(f, tier, mine[f.id], others[f.id] || [], canDispo)).join('') + `</div>`;
}

// Render another role's submitted decisions on a finding (read-only).
function peerDecisions(peers) {
  if (!peers || !peers.length) return '';
  const label = { resolve: 'Resolved', accept: 'Accepted', dismiss: 'Dismissed' };
  return `<div class="peers"><div class="peers-label">Other reviewers</div>` +
    peers.map((p) => `<div class="peer disp-${p.action}"><span class="peer-role">${esc(roleLabel(p.role))}</span> <span class="disp-tag">${label[p.action] || esc(p.action)}</span>${p.note ? ` <span class="peer-note">"${esc(p.note)}"</span>` : ''}</div>`).join('') +
    `</div>`;
}

function card(f, tier, disp, peers, canDispo) {
  const stat = f.passed === true ? '✓' : f.passed === false ? '✗' : '•';
  const statColor = f.passed === true ? 'var(--green)' : f.passed === false ? 'var(--red)' : 'var(--muted)';
  const confPct = f.detectionConfidence == null ? null : Math.round(f.detectionConfidence * 100);
  const confColor = f.detectionConfidence == null ? '#bbb' : f.detectionConfidence >= 0.9 ? 'var(--green)' : f.detectionConfidence >= 0.55 ? 'var(--amber)' : 'var(--red)';
  const judgmental = f.resolution === 'judgment' || f.resolution === 'expertise';

  const chips = [
    `<span class="chip cat-${f.category}">${f.category === 'control' ? 'Process audit' : f.category === 'engine' ? 'Engine' : 'Content'}</span>`,
    `<span class="chip ${judgmental ? 'judgment' : ''}">${esc(f.resolutionLabel)}</span>`,
  ];
  if (f.severity === 'high' || f.severity === 'medium') chips.push(`<span class="chip sev-${f.severity}">${f.severity}</span>`);
  if (f.autoEscalate) chips.push(`<span class="chip judgment">auto-escalated</span>`);

  const conf = confPct == null ? '' : `<div class="conf"><span class="label">Detection</span><span class="bar"><i style="width:${confPct}%;background:${confColor}"></i></span><span class="pct">${confPct}%</span></div>`;
  const why = tier === 'escalate' && f.escalateReason ? `<div class="detail why"><em>Why a person: ${esc(f.escalateReason)}</em></div>` : '';
  const evidence = f.evidence && f.evidence.length ? `<details class="evidence"><summary>Evidence</summary><ul>${f.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>` : '';

  // `disp` is the VIEWER'S OWN disposition (private draft). `peers` are other
  // roles' submitted decisions, shown read-only. Only internal roles can act.
  const actionable = canDispo && (f.passed === false || f.tier === 'escalate');
  let action = '';
  if (disp) {
    action = `<div class="disp disp-${disp.action} mine">
      <span class="disp-tag">Your call: ${disp.action === 'resolve' ? 'Resolved' : disp.action === 'accept' ? 'Accepted' : 'Dismissed'}</span>
      <span class="disp-meta">${fmtTime(disp.at)}</span>
      ${disp.note ? `<div class="disp-note">"${esc(disp.note)}"</div>` : ''}
      ${canDispo ? `<button class="link-btn" data-reopen="${esc(f.id)}">change</button>` : ''}
    </div>`;
  } else if (actionable) {
    action = `<div class="actions" data-fid="${esc(f.id)}">
      <button class="act resolve" data-act="resolve">Mark resolved</button>
      <button class="act accept" data-act="accept">Accept</button>
      <button class="act dismiss" data-act="dismiss">Dismiss</button>
    </div>`;
  }

  return `<div class="card ${f.passed === true ? 'pass' : ''} ${disp ? 'dispositioned' : ''}">
    <div class="row1"><span class="stat" style="color:${statColor}">${stat}</span><span class="title">${esc(f.title)}</span></div>
    <div class="detail">${esc(f.detail)}</div>${why}
    <div class="chips">${chips.join('')}</div>${conf}${evidence}${action}${peerDecisions(peers)}
  </div>`;
}

function wireFindingActions(reportId) {
  // One click, no popups — the decision applies immediately.
  const send = async (fid, action) => {
    try {
      await api('/api/disposition', { method: 'POST', body: { reportId, findingId: fid, action, note: '' } });
      const id = location.hash.match(/property\/(.+)$/)[1];
      renderProperty(id);
    } catch (e) { alert(e.message); }
  };
  $$('.actions').forEach((box) => {
    $$('.act', box).forEach((btn) => (btn.onclick = () => send(box.dataset.fid, btn.dataset.act)));
  });
  // "change" swaps the recorded decision back to the three buttons, inline.
  $$('[data-reopen]').forEach((b) => (b.onclick = () => {
    const fid = b.dataset.reopen;
    const disp = b.closest('.disp');
    const box = document.createElement('div');
    box.className = 'actions';
    box.dataset.fid = fid;
    box.innerHTML = `
      <button class="act resolve" data-act="resolve">Mark resolved</button>
      <button class="act accept" data-act="accept">Accept</button>
      <button class="act dismiss" data-act="dismiss">Dismiss</button>`;
    disp.replaceWith(box);
    $$('.act', box).forEach((btn) => (btn.onclick = () => send(fid, btn.dataset.act)));
  }));
}

function renderSignoffBar(d) {
  const el = $('#signoffBar');
  const { report, signoff } = d;
  if (signoff) {
    el.className = 'signoff-bar done';
    el.innerHTML = `<div><strong>✓ Signed off</strong> by ${esc(signoff.by)} · ${fmtTime(signoff.at)}</div><div class="muted sm">The supervisor cleared every exception and second-opinion item in their review.</div>`;
    return;
  }
  if (ROLE !== 'Supervisor') {
    el.className = 'signoff-bar pending';
    el.innerHTML = `<div class="muted sm">Awaiting <strong>Accounting Supervisor</strong> sign-off.</div>`;
    return;
  }
  // Supervisor: gated on the items still open in their OWN review pass.
  const open = d.blocking ? d.blocking.open.length : 0;
  if (open > 0) {
    el.className = 'signoff-bar pending';
    el.innerHTML = `<div><strong>${open} item${open === 1 ? '' : 's'}</strong> to disposition in your review before you can sign off</div>
      <button class="run-btn ghost" disabled>Sign off (blocked)</button>`;
    return;
  }
  el.className = 'signoff-bar ready';
  el.innerHTML = `<div><strong>Ready to sign.</strong> You've cleared every blocking item in your review.</div>
    <button class="run-btn" id="signBtn">Record sign-off</button>`;
  $('#signBtn').onclick = async () => {
    try {
      await api('/api/signoff', { method: 'POST', body: { reportId: report.id } });
      launchBalloons({ count: 26 });
      renderProperty(d.property.id);
    } catch (e) {
      if (e.data && e.data.open) alert('Blocked: ' + e.data.open.map((o) => o.title).join('; '));
      else alert(e.message);
    }
  };
}

function renderAuditTrail(events) {
  if (!events || !events.length) return ($('#auditTrail').innerHTML = '');
  $('#auditTrail').innerHTML = `<div class="tier-group"><h3>Audit trail <span class="blurb">· every action on this report, who and when</span></h3>
    <div class="audit-list">${events.slice().reverse().map((a) => `<div class="audit-row"><span class="atype atype-${a.type}">${esc(a.type)}</span><span class="adetail">${esc(a.detail)}</span><span class="ameta">${esc(a.by || '')} · ${fmtTime(a.at)}</span></div>`).join('')}</div></div>`;
}

// ── AI briefing ────────────────────────────────────────
async function loadBriefing(propertyId) {
  const el = $('#briefing');
  el.classList.remove('hidden');
  el.innerHTML = `<h4>Reviewer briefing <span class="src">generating…</span></h4>`;
  try {
    const b = await api('/api/briefing', { method: 'POST', body: { propertyId } });
    const src = b.source === 'claude' ? `Claude · ${b.model}` : 'rules-based';
    el.innerHTML = `<h4>Reviewer briefing <span class="src">${esc(src)}</span></h4><pre>${esc(b.text)}</pre>` + (b.warning ? `<div class="warn">${esc(b.warning)}</div>` : '');
  } catch (e) {
    el.innerHTML = `<h4>Reviewer briefing</h4><pre>${esc(e.message)}</pre>`;
  }
}

// ── Team chat (cross-department; internal roles only) ──
let CHAT_TIMER = null;
let CHAT_LAST_ID = null;

async function renderChat() {
  if (CHAT_TIMER) { clearInterval(CHAT_TIMER); CHAT_TIMER = null; }
  if (ROLE === 'Owner Representative') {
    $('#view').innerHTML = `<div class="panel"><div class="empty">Team chat is internal to Farbman departments.<br>
      <span class="sm">Sign out (top bar) and sign in as an internal role to join the conversation.</span></div></div>`;
    return;
  }
  const [chat, portfolio] = await Promise.all([api('/api/chat'), api('/api/portfolio').catch(() => null)]);
  const props = portfolio ? portfolio.properties : [];
  $('#view').innerHTML = `
    <div class="panel chat-panel">
      <div class="panel-head"><h2>Team chat</h2>
        <span class="muted sm">Across departments — accountants, managers, and supervisors in one place. You're posting as <strong>${esc(roleLabel(ROLE))}</strong>.</span></div>
      <div id="chatList" class="chat-list" aria-live="polite"></div>
      <form id="chatForm" class="chat-form">
        <select id="chatProp" class="chat-prop" title="Optionally tag a property">
          <option value="">No property tag</option>
          ${props.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
        </select>
        <input id="chatText" type="text" maxlength="2000" placeholder="Message the team… (@accountant @manager @supervisor pings them in Outlook)" autocomplete="off" />
        <button class="run-btn" type="submit">Send</button>
      </form>
    </div>`;

  const propName = (id) => { const p = props.find((x) => x.id === id); return p ? p.name : id; };
  const renderMsgs = (messages, append) => {
    const el = $('#chatList');
    if (!el) return;
    if (!append) el.innerHTML = '';
    if (!messages.length && !append && !el.children.length) {
      el.innerHTML = `<div class="empty sm">No messages yet — start the conversation.</div>`;
      return;
    }
    if (!append && el.querySelector('.empty')) el.innerHTML = '';
    for (const m of messages) {
      const mine = m.role === ROLE;
      const row = document.createElement('div');
      row.className = 'chat-msg' + (mine ? ' mine' : '');
      row.innerHTML = `
        <div class="chat-meta"><span class="chat-who chat-${esc(m.role).replace(/\s+/g, '-')}">${esc(roleLabel(m.role))}</span>
          <span class="muted sm">${esc(m.by)} · ${fmtTime(m.at)}</span></div>
        <div class="chat-text">${esc(m.text).replace(/@(accountant|manager|supervisor|all)/gi, '<span class="mention">@$1</span>')}${m.propertyId ? ` <a class="chat-tag" href="#/property/${esc(m.propertyId)}">${esc(propName(m.propertyId))}</a>` : ''}</div>
        ${m.pings && m.pings.length ? `<div class="ping-row">${m.pings.map((p) => `<span class="ping-chip" title="${esc(p.email)}">✉ pinged @${esc(p.to)} via Outlook${p.status === 'simulated' ? ' · demo' : p.status === 'sent' ? '' : ' · ' + esc(p.status)}</span>`).join('')}</div>` : ''}`;
      el.appendChild(row);
      CHAT_LAST_ID = m.id;
    }
    el.scrollTop = el.scrollHeight;
  };
  renderMsgs(chat.messages, false);

  $('#chatForm').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('#chatText').value.trim();
    if (!text) return;
    $('#chatText').value = '';
    try {
      const r = await api('/api/chat', { method: 'POST', body: { text, propertyId: $('#chatProp').value || undefined } });
      renderMsgs([r.message], true);
    } catch (err) { alert(err.message); }
  };

  // Poll for new messages while the page is open.
  CHAT_TIMER = setInterval(async () => {
    if (!$('#chatList')) { clearInterval(CHAT_TIMER); CHAT_TIMER = null; return; }
    const r = await api('/api/chat' + (CHAT_LAST_ID ? '?after=' + encodeURIComponent(CHAT_LAST_ID) : '')).catch(() => null);
    if (r && r.messages.length) renderMsgs(r.messages, true);
  }, 5000);
}

// ── Calibration ────────────────────────────────────────
async function renderCalibration() {
  const c = await api('/api/calibration');
  const rate = c.overall.usefulRate == null ? '—' : Math.round(c.overall.usefulRate * 100) + '%';
  const rows = c.byRule
    .map((r) => `<tr><td><code>${esc(r.rule)}</code></td><td>${r.resolved || 0}</td><td>${r.accept || 0}</td><td>${r.dismiss || 0}</td><td><b>${r.total}</b></td>
      <td><div class="bar wide"><i style="width:${r.total ? Math.round(((r.resolved + (r.accept || 0)) / r.total) * 100) : 0}%"></i></div></td></tr>`)
    .join('');
  $('#view').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="n">${c.overall.totalActed}</div><div class="l">Findings acted on</div></div>
      <div class="kpi good"><div class="n">${c.overall.useful}</div><div class="l">Useful (resolved + accepted)</div></div>
      <div class="kpi bad"><div class="n">${c.overall.dismissed}</div><div class="l">Dismissed (noise)</div></div>
      <div class="kpi"><div class="n">${rate}</div><div class="l">Useful rate</div></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Rule calibration</h2><span class="muted sm">How reviewers actually acted on each rule — the loop that shows which checks earn their keep.</span></div>
      ${c.byRule.length ? `<div class="tscroll"><table class="grid"><thead><tr><th>Rule</th><th>Resolved</th><th>Accepted</th><th>Dismissed</th><th>Total</th><th>Useful</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">No dispositions yet. Review a report and act on its findings to populate calibration.</div>`}
    </div>`;
}

// ── Audit log (global) ─────────────────────────────────
async function renderAudit() {
  const events = await api('/api/audit');
  const rows = events
    .map((a) => `<tr><td class="muted sm">${fmtTime(a.at)}</td><td><span class="atype atype-${a.type}">${esc(a.type)}</span></td><td>${esc(a.by || '')} <span class="muted sm">(${esc(a.role || '')})</span></td><td>${esc(a.detail)}</td></tr>`)
    .join('');
  $('#view').innerHTML = `<div class="panel"><div class="panel-head"><h2>Audit log</h2><span class="muted sm">Append-only. Every review run, disposition, sign-off, and import.</span></div>
    ${events.length ? `<div class="tscroll"><table class="grid"><thead><tr><th>When</th><th>Event</th><th>Actor</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">No activity yet.</div>`}</div>`;
}

// ── Monthly property-code sync ─────────────────────────
let CONN_TIMER = null;
let CONN_BUSY = false;

async function renderSync() {
  const conn = await api('/api/connector').catch(() => null);
  $('#view').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Data source</h2><span class="muted sm">Automatic — the monthly list flows in from Yardi; nobody posts it by hand.</span></div>
      <div id="connectorCard"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Manual sync <span class="muted sm">· fallback / one-off</span></h2><span class="muted sm">Paste or upload a property list to reconcile the roster by hand.</span></div>
      <p class="divblurb">Keyed on <b>property code</b>: adds new properties, updates changed names / divisions / owner reps, and flags any code that dropped off the list.
        This is the same reconcile the automatic Yardi feed runs — here you trigger it by hand.</p>
      <div class="import-grid">
        <div>
          <label class="field"><span>Upload property list (CSV)</span><input type="file" id="listFile" accept=".csv,text/csv" /></label>
          <p class="muted sm">or paste below — columns: <code>code, name, division, owner_rep, owner_rep_email</code></p>
          <textarea id="listText" class="csv-box" placeholder="code,name,division,owner_rep,owner_rep_email&#10;GR42350,42350 Grand River — Receivership,Receivership,Asset Manager,assetmanager@midwestcapital.example"></textarea>
          <div class="import-actions">
            <button class="run-btn ghost" id="sampleBtn">Load sample list</button>
            <a class="run-btn ghost" href="/api/properties/template" download="farbman-property-list-template.csv">Download template</a>
            <button class="run-btn" id="syncBtn">Sync roster</button>
          </div>
        </div>
        <div id="syncResult" class="import-result muted">The reconciliation — added, updated, unchanged, deactivated — appears here and is recorded in the audit trail.</div>
      </div>
    </div>`;

  renderConnector(conn);

  // While this page is open, refresh the connector card so an automatic poll
  // (the 30s timer) visibly updates the "last sync" line without a manual click.
  if (CONN_TIMER) clearInterval(CONN_TIMER);
  CONN_TIMER = setInterval(async () => {
    if (!$('#connectorCard')) { clearInterval(CONN_TIMER); CONN_TIMER = null; return; }
    if (CONN_BUSY) return;
    const s = await api('/api/connector').catch(() => null);
    if (s && !CONN_BUSY && $('#connectorCard')) renderConnector(s);
  }, 8000);

  $('#listFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (f) $('#listText').value = await f.text();
  };
  $('#sampleBtn').onclick = async () => {
    const r = await fetch('/api/properties/sample');
    $('#listText').value = await r.text();
  };
  $('#syncBtn').onclick = async () => {
    const list = $('#listText').value.trim();
    if (!list) return alert('Paste or upload a property list first (or click "Load sample list").');
    try {
      const r = await api('/api/properties/sync', { method: 'POST', body: { list } });
      renderSyncResult(r);
    } catch (e) { alert(e.message); }
  };
}

function renderConnector(s) {
  const el = $('#connectorCard');
  if (!el) return;
  if (!s) { el.innerHTML = '<div class="empty">Data source unavailable.</div>'; return; }
  const last = s.lastResult;
  const lastLine = s.lastPoll
    ? `Checked ${fmtTime(s.lastPoll)}${last && last.files.length ? ' · ' + esc(last.files.map((f) => f.detail || ('error: ' + f.error)).join('; ')) : ' · up to date'}`
    : 'Not checked yet';
  const live = s.sourceType === 'url';

  const head = live
    ? `<div class="conn-status">
         <span class="conn-dot on"></span>
         <div>
           <div class="conn-title">Connected — ${esc(s.sourceLabel)} <span class="live-tag">live</span></div>
           <div class="muted sm">Reading <a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">${esc(shortUrl(s.sourceUrl))}</a> · updates itself every ${s.pollSeconds}s</div>
         </div>
       </div>
       <div class="conn-actions">
         <button class="run-btn ghost" id="pollBtn">Check now</button>
         <button class="run-btn ghost" id="editSrcBtn">Change source</button>
       </div>`
    : `<div class="conn-status">
         <span class="conn-dot"></span>
         <div>
           <div class="conn-title">No live source connected <span class="sim-tag">demo</span></div>
           <div class="muted sm">Watching <code>${esc(s.inbox)}</code> · polls every ${s.pollSeconds}s</div>
         </div>
       </div>
       <div class="conn-actions">
         <button class="run-btn ghost" id="simBtn">Simulate Yardi export</button>
         <button class="run-btn ghost" id="pollBtn">Check now</button>
       </div>`;

  const pending = s.pending.length;
  const meta = `<div class="conn-meta">
      ${live ? '' : `<div class="cm"><span class="cm-label">Waiting in export folder</span><span class="cm-val ${pending ? 'hot' : ''}">${pending} file${pending === 1 ? '' : 's'}</span></div>`}
      <div class="cm"><span class="cm-label">Last sync</span><span class="cm-val">${lastLine}</span></div>
    </div>`;

  // Connect / change source form (hidden by default in live mode)
  const form = `<div class="conn-connect" id="srcForm" ${live ? 'hidden' : ''}>
      <label class="cm-label">${live ? 'Change the live source' : 'Connect a live source (Google Sheet or CSV URL)'}</label>
      <div class="src-input-row">
        <input id="srcUrl" type="url" placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?output=csv" value="${live ? esc(s.sourceUrl) : ''}" />
        <button class="run-btn" id="saveSrcBtn">${live ? 'Update' : 'Connect'}</button>
        ${live ? '<button class="run-btn ghost" id="disconnectBtn">Disconnect</button>' : ''}
      </div>
      <p class="muted sm">Paste a published CSV link. The tool polls it on a schedule — edit the sheet and the roster updates itself, no manual entry.</p>
    </div>`;

  const note = `<p class="muted sm conn-note">${live
    ? 'This roster updates itself on a schedule from the source above — no clicks, no re-keying. Point it at Yardi’s export URL once IT enables it and nothing else changes.'
    : 'Demo mode: “Simulate” drops a sample file into a watched folder. To make it update on its own, connect a live source below (a Google Sheet published as CSV works today; Yardi’s SFTP export later).'}</p>`;

  el.innerHTML = `<div class="conn-row">${head}</div>${meta}${form}${note}`;

  const pollBtn = $('#pollBtn');
  if (pollBtn) pollBtn.onclick = async () => {
    CONN_BUSY = true; pollBtn.classList.add('loading'); pollBtn.disabled = true;
    try { const r = await api('/api/connector/poll', { method: 'POST', body: {} }); renderConnector(r.status); }
    catch (e) { alert(e.message); }
    CONN_BUSY = false;
  };
  if ($('#simBtn')) $('#simBtn').onclick = async () => {
    CONN_BUSY = true; $('#simBtn').disabled = true;
    try { const r = await api('/api/connector/simulate', { method: 'POST', body: {} }); renderConnector(r.status); }
    catch (e) { alert(e.message); }
    CONN_BUSY = false;
  };
  if ($('#editSrcBtn')) $('#editSrcBtn').onclick = () => { const f = $('#srcForm'); if (f) f.hidden = !f.hidden; };
  if ($('#saveSrcBtn')) $('#saveSrcBtn').onclick = () => saveSource($('#srcUrl').value.trim());
  if ($('#disconnectBtn')) $('#disconnectBtn').onclick = () => { if (confirm('Disconnect the live source and return to demo mode?')) saveSource(''); };
}

async function saveSource(url) {
  const btn = $('#saveSrcBtn');
  CONN_BUSY = true; if (btn) { btn.classList.add('loading'); btn.disabled = true; }
  try {
    const r = await api('/api/connector/config', { method: 'POST', body: { sourceUrl: url } });
    renderConnector(r.status);
  } catch (e) {
    alert(e.message);
    if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
  }
  CONN_BUSY = false;
}

function shortUrl(u) {
  try { const x = new URL(u); return x.hostname + (x.pathname.length > 24 ? x.pathname.slice(0, 24) + '…' : x.pathname); }
  catch { return u.length > 48 ? u.slice(0, 48) + '…' : u; }
}

function renderSyncResult(r) {
  const el = $('#syncResult');
  el.classList.remove('muted');
  const group = (title, items, cls, render) => {
    if (!items.length) return '';
    return `<div class="sync-group"><h4><span class="sync-dot ${cls}"></span>${title} <span class="sync-n">${items.length}</span></h4>` +
      `<ul>${items.map(render).join('')}</ul></div>`;
  };
  el.innerHTML =
    `<div class="ok-box">✓ Roster synced — ${r.listCount} properties in the list, ${r.total} in the tool now.</div>` +
    `<div class="sync-summary">` +
    group('Added', r.added, 'add', (p) => `<li><code>${esc(p.code)}</code> ${esc(p.name)} <span class="muted sm">· ${esc(p.division)}</span></li>`) +
    group('Updated', r.updated, 'upd', (p) => `<li><code>${esc(p.code)}</code> ${esc(p.name)} <span class="muted sm">· ${esc((p.changes || []).join(', '))}</span></li>`) +
    group('Deactivated', r.deactivated, 'del', (p) => `<li><code>${esc(p.code)}</code> ${esc(p.name)} <span class="muted sm">· dropped from list</span></li>`) +
    group('Unchanged', r.unchanged, 'same', (p) => `<li><code>${esc(p.code)}</code> ${esc(p.name)}</li>`) +
    `</div>` +
    `<p class="muted sm">Recorded in the <a href="#/audit">audit trail</a>. New properties appear in the <a href="#/">portfolio</a>, awaiting their first report.</p>`;
}

// ── Import ─────────────────────────────────────────────
async function renderImport() {
  $('#view').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Import a draft report</h2><span class="muted sm">A real deployment feeds drafts from the accounting system. Here: upload/paste a CSV, or download the template.</span></div>
      <div class="import-grid">
        <div>
          <label class="field"><span>Upload CSV</span><input type="file" id="csvFile" accept=".csv,text/csv" /></label>
          <p class="muted sm">or paste below</p>
          <textarea id="csvText" class="csv-box" placeholder="section,label,amount&#10;meta,property,...&#10;revenue,Base Rent,34874.79"></textarea>
          <div class="import-actions">
            <a class="run-btn ghost" href="/api/import/template" download="farbman-report-template.csv">Download template</a>
            <button class="run-btn" id="importBtn">Import & review</button>
          </div>
        </div>
        <div id="importResult" class="import-result muted">The parsed draft will appear here, then open in the workspace.</div>
      </div>
    </div>`;

  $('#csvFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (f) $('#csvText').value = await f.text();
  };
  $('#importBtn').onclick = async () => {
    const csv = $('#csvText').value.trim();
    if (!csv) return alert('Paste or upload a CSV first.');
    try {
      const r = await api('/api/import', { method: 'POST', body: { csv } });
      $('#importResult').classList.remove('muted');
      $('#importResult').innerHTML = `<div class="ok-box">✓ Imported <strong>${esc(r.report.property)}</strong> (${esc(r.report.period.label)})</div><p class="muted sm">Opening workspace…</p>`;
      setTimeout(() => (location.hash = '#/property/' + r.property.id), 700);
    } catch (e) { alert(e.message); }
  };
}

// ── utils ──────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function roleLabel(role) {
  return { Accountant: 'Property Accountant', Reviewer: 'Property Manager', Supervisor: 'Accounting Supervisor', 'Owner Representative': 'Owner Representative' }[role] || role;
}


// ── balloons — a small celebration when a report crosses a finish line ──
const BLN_COLORS = ['#1f3a5f', '#2f6f8f', '#c8a45a', '#2f7a52', '#a23a32', '#6b3f8c'];
function launchBalloons({ count = 16, goldBias = false } = {}) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'bln-box';
  box.setAttribute('aria-hidden', 'true');
  let maxMs = 0;
  for (let i = 0; i < count; i++) {
    const b = document.createElement('div');
    b.className = 'bln';
    const color = goldBias && i % 2 ? '#c8a45a' : BLN_COLORS[i % BLN_COLORS.length];
    const size = 34 + Math.random() * 30;
    const dur = 2600 + Math.random() * 2200;
    const delay = Math.random() * 700;
    maxMs = Math.max(maxMs, dur + delay);
    b.style.cssText = 'left:' + (Math.random() * 96 + 2) + 'vw;width:' + size + 'px;height:' + size * 1.18 +
      'px;background:' + color + ';animation-duration:' + dur + 'ms,' + (1400 + Math.random() * 900) +
      'ms;animation-delay:' + delay + 'ms,' + delay + 'ms;';
    box.appendChild(b);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), maxMs + 400);
}

// ── signed-in identity bar ─────────────────────────────
const ROLE_SUBS = { Accountant: 'Prepares the draft', Reviewer: 'Reviews & dispositions', Supervisor: 'Signs off', 'Owner Representative': 'Receives the report' };
function updateWhoami() {
  $('#whoName').textContent = roleLabel(ROLE);
  $('#whoSub').textContent = ROLE_SUBS[ROLE] || '';
}
$('#signOutBtn').onclick = () => {
  sessionStorage.removeItem('fp_signed_in');
  showSignIn();
};

// ── sign-in: pick your role when the demo opens ────────
// Shown once per browser session so every demo starts from "who are you?".
// The "Acting as" tabs still switch roles at any time after.
function showSignIn() {
  const roles = [
    { role: 'Accountant', name: 'Property Accountant', sub: 'Prepares the draft' },
    { role: 'Reviewer', name: 'Property Manager', sub: 'Reviews & dispositions' },
    { role: 'Supervisor', name: 'Accounting Supervisor', sub: 'Signs off' },
    { role: 'Owner Representative', name: 'Owner Representative', sub: 'Receives the report' },
  ];
  const existing = document.querySelector('.signin');
  if (existing) existing.remove();
  const ov = document.createElement('div');
  ov.className = 'signin';
  ov.innerHTML = `
    <div class="signin-glow g1"></div><div class="signin-glow g2"></div>
    <div class="signin-hero" role="dialog" aria-modal="true" aria-labelledby="signinTitle">
      <div class="signin-eyebrow">Farbman Group · FirstPass</div>
      <h1 class="signin-h1">Month-end review,<br><span class="rotor" id="signinRotor">faster.</span></h1>
      <p class="signin-tag">The AI first pass reads every property report and flags what matters —
        your team decides, signs off, and releases. Every call on the record.</p>
      <div class="signin-label" id="signinTitle">Sign in as your role</div>
      <div class="signin-roles">
        ${roles.map((r) => `
          <button class="signin-role" data-role="${esc(r.role)}">
            <span class="sr-name">${esc(r.name)}</span>
            <span class="sr-sub">${esc(r.sub)}</span>
          </button>`).join('')}
      </div>
      <div class="signin-foot">Demo — pick any seat; sign out from the top bar to change.</div>
    </div>`;
  document.body.appendChild(ov);

  // Cycling headline word (framer-motion idea, translated to plain CSS/JS).
  const words = ['faster.', 'consistent.', 'defensible.'];
  let wi = 0;
  let rotorTimer = null;
  const rotor = ov.querySelector('#signinRotor');
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    rotorTimer = setInterval(() => {
      wi = (wi + 1) % words.length;
      rotor.classList.remove('swap');
      void rotor.offsetWidth; // restart the animation
      rotor.textContent = words[wi];
      rotor.classList.add('swap');
    }, 2200);
  }

  $$('.signin-role', ov).forEach((b) => (b.onclick = () => {
    if (rotorTimer) clearInterval(rotorTimer);
    ROLE = b.dataset.role;
    localStorage.setItem('farbman_role', ROLE);
    sessionStorage.setItem('fp_signed_in', '1');
    ov.remove();
    updateWhoami();
    router();
  }));
}

// ── boot ───────────────────────────────────────────────
updateWhoami();
window.addEventListener('hashchange', router);
router();
if (!sessionStorage.getItem('fp_signed_in')) showSignIn();
