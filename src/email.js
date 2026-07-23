'use strict';

/**
 * SMTP email for @mention pings — the no-Azure path to real mail.
 *
 * Set in the host's environment (Render → Environment):
 *   SMTP_USER  — the mailbox to send from (e.g. a Gmail address)
 *   SMTP_PASS  — its app password (Gmail: Google Account → Security →
 *                2-Step Verification → App passwords)
 *   PING_TO    — where pings land (defaults to SMTP_USER). For a demo,
 *                point every ping at one inbox.
 *   SMTP_HOST / SMTP_PORT — optional; default smtp.gmail.com:465 (TLS).
 *
 * Without SMTP_USER/SMTP_PASS this module reports unconfigured and the
 * connector falls back to recorded "demo" pings — nothing throws.
 */

const nodemailer = require('nodemailer');

const configured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);

let _transport = null;
function transport() {
  if (_transport) return _transport;
  const port = Number(process.env.SMTP_PORT || 465);
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: process.env.SMTP_SECURE != null ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transport;
}

const pingTo = () => process.env.PING_TO || process.env.SMTP_USER;

/** Send one @mention ping. Returns 'sent' or throws (caller records the error). */
async function sendPing({ handle, from, text, propertyName }) {
  const info = await transport().sendMail({
    from: `"Farbman FirstPass" <${process.env.SMTP_USER}>`,
    to: pingTo(),
    subject: `FirstPass — ${from} mentioned @${handle}${propertyName ? ` · ${propertyName}` : ''}`,
    text:
      `${from} mentioned @${handle} in team chat:\n\n` +
      `“${text}”\n\n` +
      (propertyName ? `Property: ${propertyName}\n` : '') +
      `Open the workspace: https://farbman.onrender.com`,
    html:
      `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px">` +
      `<div style="background:#1F3A5F;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0">` +
      `<div style="font-size:11px;letter-spacing:.12em;color:#c8a45a">FARBMAN GROUP · FIRSTPASS</div>` +
      `<div style="font-size:16px;font-weight:700;margin-top:2px">${esc(from)} mentioned @${esc(handle)} in team chat</div></div>` +
      `<div style="border:1px solid #e3e0d8;border-top:none;border-radius:0 0 10px 10px;padding:16px 18px">` +
      `<p style="font-size:14px;color:#161B22;margin:0 0 10px">“${esc(text)}”</p>` +
      (propertyName ? `<p style="font-size:12px;color:#6B7888;margin:0 0 12px">Property: ${esc(propertyName)}</p>` : '') +
      `<a href="https://farbman.onrender.com" style="font-size:13px;color:#2f6f8f">Open the workspace →</a>` +
      `</div></div>`,
  });
  return info && info.accepted && info.accepted.length ? 'sent' : 'not accepted';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

module.exports = { configured, sendPing, pingTo };
