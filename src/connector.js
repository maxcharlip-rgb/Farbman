'use strict';

/**
 * Data-source connector — keeps the roster current with no manual entry.
 *
 * Two source kinds, both auto-polled on a schedule:
 *   1. Live URL  — a published CSV (Google Sheet → "publish to web as CSV", or
 *      any hosted CSV / Yardi export URL). This is the "it updates itself" path:
 *      edit the sheet, the tool reconciles on its next poll. No buttons.
 *   2. Folder    — files dropped into data/yardi-inbox (stands in for a Yardi
 *      SFTP export). Point YARDI_INBOX_DIR at a mounted export for live Yardi.
 *
 * Each poll ingests whatever it finds: property lists reconcile the roster,
 * report CSVs import for review. On an always-on host the interval poller keeps
 * everything current 24/7; a lightweight poll-on-open covers idle/free hosts.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const store = require('./store');
const { parseCsv, parsePropertyList } = require('./ingest');
const { SAMPLE_PROPERTY_LIST } = require('./data/reports');

const INBOX_DIR = process.env.YARDI_INBOX_DIR || path.join(__dirname, '..', 'data', 'yardi-inbox');
const PROCESSED_DIR = path.join(INBOX_DIR, 'processed');
const AUTO_ACTOR = { by: 'Yardi export (automated)', role: 'System' };

let polling = false; // guard against overlapping polls

function ensureDirs() {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
}

function listPending() {
  ensureDirs();
  return fs
    .readdirSync(INBOX_DIR)
    .filter((f) => /\.csv$/i.test(f))
    .filter((f) => {
      try { return fs.statSync(path.join(INBOX_DIR, f)).isFile(); } catch { return false; }
    });
}

// Decide what a dropped/fetched file is by its header/shape.
function sniffType(text) {
  const firstLine = (text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '').toLowerCase();
  if (firstLine.includes('section') && firstLine.includes('amount')) return 'report';
  if (/(^|\n)\s*(meta|revenue|expense|balance|checks|exec)\s*,/i.test(text)) return 'report';
  if (firstLine.includes('code') || firstLine.includes('property') || firstLine.includes('name')) return 'propertyList';
  return 'propertyList';
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

// GET a URL as text, following redirects (Google's published-CSV URLs redirect).
function fetchUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    let lib;
    try { lib = new URL(url).protocol === 'http:' ? http : https; } catch { return reject(new Error('invalid URL')); }
    const req = lib.get(url, { headers: { 'User-Agent': 'farbman-review-engine', Accept: 'text/csv,text/plain,*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchUrl(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('request timed out')));
  });
}

// Ingest one CSV blob (property list or report), appending a result entry.
function ingestText(text, source, actor, handled) {
  const type = sniffType(text);
  if (type === 'report') {
    const report = parseCsv(text);
    store.upsertReport(report, actor.by, actor.role);
    handled.push({ source, type: 'report', detail: `${report.property} · ${report.period.label}` });
  } else {
    const list = parsePropertyList(text);
    if (!list.length) throw new Error('no property rows found');
    const r = store.syncProperties(list, actor);
    handled.push({ source, type: 'propertyList', detail: `${r.added.length} added · ${r.updated.length} updated · ${r.deactivated.length} deactivated` });
  }
}

/** One poll cycle: fetch the live URL (if configured) and drain the folder. */
async function pollOnce(actor = AUTO_ACTOR) {
  if (polling) return { at: new Date().toISOString(), count: 0, files: [], skipped: true };
  polling = true;
  const handled = [];
  try {
    const c = store.getConnector();

    // 1) live URL source
    if (c.sourceUrl) {
      try {
        const text = await fetchUrl(c.sourceUrl);
        ingestText(text, 'url', actor, handled);
      } catch (e) {
        handled.push({ source: 'url', error: e.message });
      }
    }

    // 2) folder drops (eventual Yardi SFTP)
    ensureDirs();
    for (const f of listPending()) {
      const full = path.join(INBOX_DIR, f);
      let text;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      try {
        ingestText(text, 'folder', actor, handled);
        fs.renameSync(full, path.join(PROCESSED_DIR, `${stamp()}__${f}`));
      } catch (e) {
        handled.push({ source: 'folder', file: f, error: e.message });
        try { fs.renameSync(full, path.join(PROCESSED_DIR, `FAILED__${stamp()}__${f}`)); } catch { /* leave it */ }
      }
    }
  } finally {
    polling = false;
  }

  const meaningful = handled.filter((h) => h.error || !/0 added · 0 updated · 0 deactivated/.test(h.detail || ''));
  const result = { at: new Date().toISOString(), count: handled.length, files: handled };
  store.setConnector({ lastPoll: result.at, lastResult: meaningful.length ? result : store.getConnector().lastResult });
  return result;
}

/** Poll if a source is configured and the last poll is stale — non-blocking. */
function maybePoll() {
  const c = store.getConnector();
  if (!c.sourceUrl && !listPending().length) return;
  const ageMs = c.lastPoll ? Date.now() - Date.parse(c.lastPoll) : Infinity;
  if (ageMs >= Math.max(5, c.pollSeconds || 30) * 1000) {
    pollOnce().catch(() => {}); // fire and forget; store updates for next read
  }
}

/** Simulate a Yardi export landing in the folder (demo when no live URL is set). */
function simulateDrop() {
  ensureDirs();
  const name = `yardi-property-export-${new Date().toISOString().slice(0, 10)}.csv`;
  fs.writeFileSync(path.join(INBOX_DIR, name), SAMPLE_PROPERTY_LIST);
  return { file: name };
}

/** Point the connector at a live CSV URL (empty string clears it → folder mode). */
function setSource({ sourceUrl, pollSeconds, sourceLabel } = {}) {
  const patch = {};
  if (sourceUrl !== undefined) {
    const u = String(sourceUrl || '').trim();
    if (u && !/^https?:\/\//i.test(u)) throw new Error('URL must start with http:// or https://');
    patch.sourceUrl = u || null;
    patch.sourceLabel = sourceLabel || (u ? 'Live property list (CSV URL)' : 'Yardi scheduled export');
  } else if (sourceLabel) {
    patch.sourceLabel = sourceLabel;
  }
  if (pollSeconds !== undefined) {
    const n = parseInt(pollSeconds, 10);
    if (Number.isFinite(n)) patch.pollSeconds = Math.max(10, Math.min(3600, n));
  }
  return store.setConnector(patch);
}

// On boot, honor a URL provided via env if the store has none configured.
function applyEnvSource() {
  const envUrl = process.env.YARDI_SOURCE_URL;
  if (envUrl && !store.getConnector().sourceUrl) {
    try { setSource({ sourceUrl: envUrl }); } catch { /* ignore bad env */ }
  }
}

function status() {
  const c = store.getConnector() || {};
  const sourceType = c.sourceUrl ? 'url' : 'folder';
  return {
    enabled: c.enabled !== false,
    sourceType,
    sourceUrl: c.sourceUrl || null,
    sourceLabel: c.sourceLabel || (c.sourceUrl ? 'Live property list (CSV URL)' : 'Yardi scheduled export'),
    pollSeconds: c.pollSeconds || 30,
    inbox: path.relative(path.join(__dirname, '..'), INBOX_DIR),
    pending: listPending(),
    lastPoll: c.lastPoll || null,
    lastResult: c.lastResult || null,
    live: sourceType === 'url', // a real, self-updating source is connected
  };
}

let timer = null;
/** Poll on the configured interval; ingest anything new. */
function startPolling() {
  applyEnvSource();
  const c = store.getConnector();
  const ms = Math.max(10, c.pollSeconds || 30) * 1000;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    try {
      if (store.getConnector().enabled === false) return;
      pollOnce().catch((e) => console.warn('connector poll failed:', e.message));
    } catch (e) {
      console.warn('connector poll failed:', e.message);
    }
  }, ms);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { pollOnce, maybePoll, simulateDrop, setSource, status, startPolling, listPending, INBOX_DIR };
