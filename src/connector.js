'use strict';

/**
 * Yardi data-source connector (Option 1: scheduled export → watched folder).
 *
 * In production, Farbman's Yardi admin schedules the property list and the
 * monthly financial packets to drop into an SFTP / secure folder. This module
 * watches that folder, ingests whatever lands (property lists reconcile the
 * roster; report CSVs import + open for review), and does it on a timer — so
 * nobody re-keys anything. The manual paste on the Sync page stays as a
 * fallback / one-off override.
 *
 * Here the "folder" is a local directory (data/yardi-inbox). Point INBOX_DIR at
 * a real mounted SFTP export and the exact same watcher runs against live Yardi.
 */

const fs = require('fs');
const path = require('path');
const store = require('./store');
const { parseCsv, parsePropertyList } = require('./ingest');
const { SAMPLE_PROPERTY_LIST } = require('./data/reports');

const INBOX_DIR = process.env.YARDI_INBOX_DIR || path.join(__dirname, '..', 'data', 'yardi-inbox');
const PROCESSED_DIR = path.join(INBOX_DIR, 'processed');

const AUTO_ACTOR = { by: 'Yardi export (automated)', role: 'System' };

function ensureDirs() {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
}

// Pending = CSV files sitting in the inbox top level (not the processed subdir).
function listPending() {
  ensureDirs();
  return fs
    .readdirSync(INBOX_DIR)
    .filter((f) => /\.csv$/i.test(f))
    .filter((f) => {
      try { return fs.statSync(path.join(INBOX_DIR, f)).isFile(); } catch { return false; }
    });
}

// Decide what a dropped file is by its header/shape.
function sniffType(text) {
  const firstLine = (text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '').toLowerCase();
  if (firstLine.includes('section') && firstLine.includes('amount')) return 'report';
  if (/(^|\n)\s*(meta|revenue|expense|balance|checks|exec)\s*,/i.test(text)) return 'report';
  if (firstLine.includes('code') || firstLine.includes('property') || firstLine.includes('name')) return 'propertyList';
  return 'propertyList';
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Read every pending file, ingest it, move it to processed/. Records the result on the connector state. */
function processInbox(actor = AUTO_ACTOR) {
  ensureDirs();
  const files = listPending();
  const handled = [];
  for (const f of files) {
    const full = path.join(INBOX_DIR, f);
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const type = sniffType(text);
    try {
      if (type === 'report') {
        const report = parseCsv(text);
        store.upsertReport(report, actor.by, actor.role);
        handled.push({ file: f, type: 'report', detail: `${report.property} · ${report.period.label}` });
      } else {
        const list = parsePropertyList(text);
        if (!list.length) throw new Error('no property rows found');
        const r = store.syncProperties(list, actor);
        handled.push({ file: f, type: 'propertyList', detail: `${r.added.length} added · ${r.updated.length} updated · ${r.deactivated.length} deactivated` });
      }
      fs.renameSync(full, path.join(PROCESSED_DIR, `${stamp()}__${f}`));
    } catch (e) {
      handled.push({ file: f, type, error: e.message });
      try { fs.renameSync(full, path.join(PROCESSED_DIR, `FAILED__${stamp()}__${f}`)); } catch { /* leave it */ }
    }
  }
  const result = { at: new Date().toISOString(), count: handled.length, files: handled };
  const patch = { lastPoll: result.at };
  if (handled.length) patch.lastResult = result;
  store.setConnector(patch);
  return result;
}

/** Simulate a Yardi export landing in the folder (writes the sample property list). */
function simulateDrop() {
  ensureDirs();
  const name = `yardi-property-export-${new Date().toISOString().slice(0, 10)}.csv`;
  fs.writeFileSync(path.join(INBOX_DIR, name), SAMPLE_PROPERTY_LIST);
  return { file: name };
}

function status() {
  const c = store.getConnector() || {};
  return {
    enabled: c.enabled !== false,
    sourceLabel: c.sourceLabel || 'Yardi scheduled export',
    pollSeconds: c.pollSeconds || 30,
    inbox: path.relative(path.join(__dirname, '..'), INBOX_DIR),
    pending: listPending(),
    lastPoll: c.lastPoll || null,
    lastResult: c.lastResult || null,
    simulated: !process.env.YARDI_INBOX_DIR, // real when pointed at a mounted export
  };
}

let timer = null;
/** Poll the export folder on the configured interval; ingest anything new. */
function startPolling() {
  const c = store.getConnector();
  const ms = Math.max(5, c.pollSeconds || 30) * 1000;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    try {
      if (store.getConnector().enabled === false) return;
      if (listPending().length) processInbox();
    } catch (e) {
      console.warn('connector poll failed:', e.message);
    }
  }, ms);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { processInbox, simulateDrop, status, startPolling, listPending, INBOX_DIR };
