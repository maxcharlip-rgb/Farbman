'use strict';

/**
 * Outlook connector — pings people who get @mentioned in team chat.
 *
 * Real mode: set the four env vars below (an Azure "app registration" with the
 * Mail.Send application permission — Farbman IT creates this once) and pings go
 * out as real Outlook mail via Microsoft Graph.
 *
 *   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET  — the app registration
 *   OUTLOOK_SENDER                                 — mailbox to send from
 *
 * Demo mode (no env vars): the ping is recorded on the message and in the
 * audit trail — same pattern as releasing a report to the owner rep.
 */

// Who can be @mentioned. Handles are stable; names/emails are the demo personas.
const DIRECTORY = [
  { handle: 'max', name: 'Max Charlip', role: 'Max Charlip', email: 'max@farbman.example' },
  { handle: 'accountant', name: 'A. Accountant', role: 'Accountant', email: 'accountant@farbman.example' },
  { handle: 'manager', name: 'L. Reviewer', role: 'Reviewer', email: 'manager@farbman.example' },
  { handle: 'supervisor', name: 'D. Okafor', role: 'Supervisor', email: 'supervisor@farbman.example' },
  { handle: 'ownerrep', name: 'Owner Representative', role: 'Owner Representative', email: 'ownerrep@farbman.example' },
];

const email = require('./email');

const configured = () =>
  !!(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.OUTLOOK_SENDER);

/** Find @mentions in a chat message. Supports @handle and @all. */
function parseMentions(text) {
  const found = new Map();
  const re = /@([a-z]+)/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const h = m[1].toLowerCase();
    if (h === 'all') for (const p of DIRECTORY) found.set(p.handle, p);
    else {
      const p = DIRECTORY.find((x) => x.handle === h);
      if (p) found.set(p.handle, p);
    }
  }
  return [...found.values()];
}

let _token = null; // { value, expiresAt }
async function graphToken() {
  if (_token && Date.now() < _token.expiresAt - 60000) return _token.value;
  const res = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  if (!res.ok) throw new Error(`Graph auth failed: HTTP ${res.status}`);
  const d = await res.json();
  _token = { value: d.access_token, expiresAt: Date.now() + (d.expires_in || 3600) * 1000 };
  return _token.value;
}

/** Ping one person about a chat mention. Returns { to, status } — never throws. */
async function ping(person, { from, text, propertyName }) {
  // Send chain: Microsoft Graph when the Azure registration is configured;
  // otherwise plain SMTP (see src/email.js — the demo-friendly real-mail path);
  // otherwise record the ping as a demo simulation. Never throws.
  if (!configured()) {
    if (email.configured()) {
      try {
        const status = await email.sendPing({ handle: person.handle, from, text, propertyName });
        return { to: person.handle, email: email.pingTo(), status, via: 'email' };
      } catch (e) {
        return { to: person.handle, email: email.pingTo(), status: 'error ' + e.message, via: 'email' };
      }
    }
    return { to: person.handle, email: person.email, status: 'simulated' };
  }
  try {
    const token = await graphToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.OUTLOOK_SENDER)}/sendMail`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: `FirstPass — ${from} mentioned you in team chat`,
          body: { contentType: 'Text', content: `${from} mentioned you:\n\n"${text}"\n\n${propertyName ? `Property: ${propertyName}\n` : ''}Open FirstPass to reply.` },
          toRecipients: [{ emailAddress: { address: person.email } }],
        },
        saveToSentItems: false,
      }),
    });
    return { to: person.handle, email: person.email, status: res.status === 202 ? 'sent' : `error HTTP ${res.status}` };
  } catch (e) {
    return { to: person.handle, email: person.email, status: 'error ' + e.message };
  }
}

module.exports = { DIRECTORY, parseMentions, ping, configured };
