# Farbman Group — First-Pass Report Review Engine

A working prototype of the AI-assisted first-pass review tool: **the staff accountant's
pre-check** that flags material items on a draft property report **before** it goes to the
owner rep — and long before the supervisor's sign-off. Advisory only: it never signs off,
never replaces the supervisor review, and never declares a report "approved."

Built for the intern final project; shaped directly by stakeholder feedback (A. Gutman,
J. Margolis, A. Hafron interviews, June–July 2026).

## Stakeholder feedback → what got built

| What stakeholders said | What the engine does |
|---|---|
| *"Most of my time is spent on the narrative portions"* (Margolis) | Narrative audit layer: exec summary, budget variance notes, AR notes are first-class checked sections |
| *"Notes carried over from the prior month"* | **Stale-note detection** — flags sections identical / near-identical to last month (escalates: only the reviewer knows if that's legitimate) |
| *"Notes not updated based on my revisions… revert back to original notes"* | **Reverted-note detection** — catches a draft that matches last month's *pre-revision* text instead of the reviewer's revision. Deterministic exception, high severity |
| *"Lack of complete sentences"* | Incomplete-sentence heuristics per narrative section (flag tier — heuristic, human confirms) |
| *"Bank account numbers are removed… since this becomes a public record"* | **Public-record redaction scan** on receivership reports — any account-style digit run (7+) in narrative/notes/bank-rec text is a deterministic exception; masked forms (****7894) pass |
| *"Reports are cumulative… an existing error in a prior month's report could continue"* (Gutman) | **Cumulative YTD continuity** — YTD(this month) must equal YTD(prior) + this period's NOI. A break is flagged as propagating. A pass explicitly notes it proves continuity, not correctness of the base |
| *"Multi-month trend view… helpful"* (Gutman) | **Trend panel** — up to 12 periods of NOI, YTD NOI, revenue, expenses, cash, occupancy with sparklines |
| *"Cross-report consistency — yes"* | Exec-summary vs. statement ties, cash roll-forward, check-sequence continuity across periods |
| *"Confidence or needs-second-opinion flag — yes"* | Two-axis model (detection confidence × resolution type) → three tiers; judgment items always escalate |
| *"A tool the staff accountant uses as a check before sending to the owner rep"* (Margolis) | Role-aware workflow: Accountant runs the pass → Reviewer dispositions findings → only the Supervisor can record sign-off, and only after every exception/second-opinion item is dispositioned |

**Answers to open questions from the thread:**
- *Receiver's reports or financial reports in general?* General — the engine runs on all four
  divisions. Receivership reports additionally get the public-record redaction scan and are
  the primary audience for the trend view.
- *The four divisions* (as modeled here): Receivership, Joint Venture, 3rd Party Management, REO.
- *API cost:* the rules engine is **free to run** — it's deterministic, no API involved. The
  optional Claude-written reviewer briefing is the only per-report API cost and is off by
  default (a rules-based briefing renders without it).

## Run it

```bash
cd farbman-review-engine
npm install
npm start
# open http://localhost:4178
```

Optional Claude briefing: `export ANTHROPIC_API_KEY=sk-ant-...` before `npm start`.
Live state persists in `data/store.json` — delete it to reset to the seeded demo.

## The demo portfolio (sample data only)

| Property | Division | What it demonstrates |
|---|---|---|
| 42350 Grand River (Receiver) | Receivership | Reverted note, stale note, fragment, unredacted account #, check-sequence gap, partial review, rubber-stamp signal, 3-month trend, YTD continuity **pass** |
| Novi Commons | Joint Venture | A clean report — nearly everything auto-verifies |
| Orchard Lake Professional Plaza | 3rd Party | **Cumulative YTD break** — the propagating-error case |
| 28000 Twelve Mile | REO | First period: no baseline, missing bank rec + narrative sections → auto-escalation |

## Review lifecycle (all persisted, all audited)

1. **Run first-pass** — engine produces tiered findings (deterministic / flag / second-opinion).
2. **Disposition** — reviewer marks each blocking finding resolved / accepted / dismissed
   (dismissal requires a note). Every action is logged with who/when.
3. **Sign-off** — Supervisor-only, and **blocked** until every open exception and
   second-opinion item is dispositioned. Re-running the review or changing a disposition
   invalidates a prior sign-off.
4. **Calibration** — per-rule accepted/resolved/dismissed rates show which checks earn
   their keep (the dismissal rate is the noise signal).
5. **Audit log** — append-only record of every run, disposition, sign-off, and import.

## API

- `GET  /api/portfolio` — divisions + per-property review status
- `GET  /api/property/:id` — report + review + dispositions + sign-off + audit trail
- `GET  /api/trend/:propertyId` — multi-month series
- `POST /api/review` `{ propertyId }` — run + persist the first-pass review
- `POST /api/review/inline` `{ report, prior?, policy? }` — integration path (accounting system pushes a draft)
- `POST /api/disposition` `{ reportId, findingId, action, note }` — resolve / accept / dismiss
- `POST /api/signoff` `{ reportId }` — Supervisor role only; gated on dispositions
- `POST /api/import` — CSV or JSON draft (`GET /api/import/template` for the CSV template)
- `GET  /api/calibration`, `GET /api/audit`
- `POST /api/briefing` `{ propertyId }` — reviewer briefing (Claude if key set, else rules-based)

## Layout

```
server.js                  Express API + serves the frontend
src/engine/
  policy.js                Per-division thresholds (incl. narrative + redaction knobs)
  confidence.js            Two-axis model → tier + second-opinion derivation
  index.js                 Orchestrator + advisory summary
  rules/
    arithmetic.js          Foots & ties
    bankrec.js             Check-sequence continuity / missing bank rec
    consistency.js         YTD continuity, round-number accruals, cash-vs-NOI, going concern
    crossref.js            Negative revenue ↔ receivable coincidences
    narrative.js           Stale / reverted / fragment / missing-section checks
    redaction.js           Public-record account-number scan (receivership)
    monthOverMonth.js      Cash roll-forward, recurring items, large swings
    process.js             Review-chain, segregation of duties, timeliness, rubber-stamp
src/store.js               File-backed store: reviews, dispositions, sign-offs, audit log
src/ingest.js              CSV/JSON draft ingestion + template
src/data/reports.js        Seeded sample portfolio (4 divisions, planted scenarios)
src/llm.js                 Optional Claude briefing (deterministic fallback)
public/                    Frontend (portfolio, workspace, calibration, audit, import)
```

## Boundaries

- Not a gate or an approver — no "passes" state exists anywhere in the product.
- "Audit" stays internal framing. Never expose an "AI Audit" stamp to a lender, court, or
  client — that implies assurance nobody is providing.
- Pattern scans (redaction, fragments) assist the reviewer's check; they don't replace the
  final visual pass before filing.
- Judgment-heavy receivership matters (going concern, valuation, lienholder distributions,
  court reporting) are deliberately out of scope and route to humans.
- Sample data only here. Real reports require data-handling controls first.

## Real email for @mention pings (demo)

No Azure needed — plain SMTP. In Render → Environment add:

- `SMTP_USER` — the Gmail address to send from
- `SMTP_PASS` — a Gmail **app password** (Google Account → Security → 2-Step Verification → App passwords)
- `PING_TO` — optional; where pings land. Leave it unset and they go to `SMTP_USER` itself

Saving env vars triggers a redeploy (~1 min). Then verify with
`curl -X POST https://<host>/api/ping/test` — HTTP 200 means the mail went out,
and every `@mention` in team chat emails `PING_TO` for real (chip shows
"✉ emailed @…"). Without these vars pings stay recorded as "demo".
