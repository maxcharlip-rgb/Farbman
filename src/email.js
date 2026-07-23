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

// Two ways to send, checked in order:
//   1. Resend (resend.com) — RESEND_API_KEY + PING_TO. HTTPS on port 443, so it
//      works on hosts that block outbound SMTP (Render's free tier does).
//   2. SMTP — SMTP_USER + SMTP_PASS. Fast timeouts so a blocked port fails
//      loudly in seconds instead of hanging the request.
const resendConfigured = () => !!(process.env.RESEND_API_KEY && process.env.PING_TO);
const smtpConfigured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);
const configured = () => resendConfigured() || smtpConfigured();

let _transport = null;
function transport() {
  if (_transport) return _transport;
  const port = Number(process.env.SMTP_PORT || 465);
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: process.env.SMTP_SECURE != null ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
  });
  return _transport;
}

const pingTo = () => process.env.PING_TO || process.env.SMTP_USER;

async function sendViaResend({ handle, from, text, propertyName }) {
  const res = await fetch(process.env.RESEND_URL || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'Farbman FirstPass <onboarding@resend.dev>',
      to: [pingTo()],
      subject: subjectFor({ handle, from, propertyName }),
      text: textFor({ handle, from, text, propertyName }),
      html: htmlFor({ handle, from, text, propertyName }),
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (res.ok) return 'sent';
  const body = await res.text().catch(() => '');
  throw new Error(`Resend HTTP ${res.status}${body ? ' — ' + body.slice(0, 140) : ''}`);
}

const subjectFor = ({ handle, from, propertyName }) =>
  `FirstPass — ${from} mentioned @${handle}${propertyName ? ` · ${propertyName}` : ''}`;
const textFor = ({ handle, from, text, propertyName }) =>
  `${from} mentioned @${handle} in team chat:\n\n“${text}”\n\n` +
  (propertyName ? `Property: ${propertyName}\n` : '') +
  `Open the workspace: https://farbman.onrender.com`;
const htmlFor = ({ handle, from, text, propertyName }) =>
  `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px">` +
  `<div style="background:#1F3A5F;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0">` +
  `<div style="font-size:11px;letter-spacing:.12em;color:#c8a45a">FARBMAN GROUP · FIRSTPASS</div>` +
  `<div style="font-size:16px;font-weight:700;margin-top:2px">${esc(from)} mentioned @${esc(handle)} in team chat</div></div>` +
  `<div style="border:1px solid #e3e0d8;border-top:none;border-radius:0 0 10px 10px;padding:16px 18px">` +
  `<p style="font-size:14px;color:#161B22;margin:0 0 10px">“${esc(text)}”</p>` +
  (propertyName ? `<p style="font-size:12px;color:#6B7888;margin:0 0 12px">Property: ${esc(propertyName)}</p>` : '') +
  `<a href="https://farbman.onrender.com" style="font-size:13px;color:#2f6f8f">Open the workspace →</a>` +
  `</div></div>`;

/** Send one @mention ping. Returns 'sent' or throws (caller records the error). */
async function sendPing({ handle, from, text, propertyName }) {
  if (resendConfigured()) return sendViaResend({ handle, from, text, propertyName });
  const info = await transport().sendMail({
    from: `"Farbman FirstPass" <${process.env.SMTP_USER}>`,
    to: pingTo(),
    subject: subjectFor({ handle, from, propertyName }),
    text: textFor({ handle, from, text, propertyName }),
    html: htmlFor({ handle, from, text, propertyName }),
  });
  return info && info.accepted && info.accepted.length ? 'sent' : 'not accepted';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

module.exports = { configured, sendPing, pingTo };
