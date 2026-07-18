// ===== EMAIL DELIVERY =====
// A thin wrapper over nodemailer that degrades to a no-op when SMTP is not
// configured, so notifications (utils/notify.js) work identically with or
// without email. In test mode — or whenever SMTP is unconfigured — deliveries
// are captured in an in-memory outbox so behavior can be asserted without a
// real mail server.

const config = require('../config');

// Which notification types map to which user-settings toggle. A type not listed
// here is always allowed (subject only to the master email_notifications flag).
const TYPE_TOGGLE = {
  assigned: 'notify_assigned',
  mention: 'notify_mentions',
  comment: 'notify_comments',
  status_changed: 'notify_status_changes',
};

const outbox = [];
let transport = null;

function getTransport() {
  if (!config.email.enabled()) return null;
  if (transport) return transport;
  const nodemailer = require('nodemailer');
  transport = config.email.url
    ? nodemailer.createTransport(config.email.url)
    : nodemailer.createTransport({
        host: config.email.host,
        port: config.email.port,
        secure: config.email.secure,
        auth: config.email.user ? { user: config.email.user, pass: config.email.pass } : undefined,
      });
  return transport;
}

// Send an email best-effort. Returns { skipped, id?, error? } and never throws —
// callers treat it as fire-and-forget.
async function sendMail({ to, subject, html, text }) {
  if (!to) return { skipped: true };
  const t = getTransport();
  // No transport (unconfigured) or test env: capture to the outbox instead.
  if (!t || config.env === 'test') {
    outbox.push({ to, subject, html, text, at: new Date().toISOString() });
    return { skipped: !t, outboxed: true };
  }
  try {
    const info = await t.sendMail({ from: config.email.from, to, subject, html, text });
    return { id: info.messageId };
  } catch (e) {
    console.error('sendMail failed:', e.message);
    return { error: e.message };
  }
}

// Wrap body content in a simple, email-safe HTML shell.
function shell(title, bodyHtml, ctaText, ctaUrl) {
  const button = ctaUrl
    ? `<p style="margin:24px 0"><a href="${ctaUrl}" style="background:#0c66e4;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block;font-weight:600">${ctaText}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;padding:24px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#172b4d">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;padding:28px">
      <div style="font-weight:800;font-size:18px;color:#0c66e4;margin-bottom:16px">Atlas</div>
      <h1 style="font-size:18px;margin:0 0 12px">${title}</h1>
      <div style="font-size:14px;line-height:1.6;color:#42526e">${bodyHtml}</div>
      ${button}
      <hr style="border:0;border-top:1px solid #ebecf0;margin:24px 0">
      <p style="font-size:12px;color:#8993a4;margin:0">You're receiving this because of your Atlas notification settings. Manage them in Settings.</p>
    </div></body></html>`;
}

// Given an in-app notification, deliver the matching email if the recipient's
// settings allow it. `recipient` carries { email, name } + settings columns.
async function sendNotificationEmail(recipient, { type, message, link, actorName }) {
  if (!recipient || !recipient.email) return { skipped: true };
  // Master toggle (default on) then the per-type toggle if one applies.
  if (recipient.email_notifications === 0) return { skipped: true };
  const toggle = TYPE_TOGGLE[type];
  if (toggle && recipient[toggle] === 0) return { skipped: true };

  const url = link ? `${config.email.appUrl.replace(/\/$/, '')}${link.startsWith('/') ? '' : '/'}${link}` : null;
  const esc = (s) => String(s || '').replace(/</g, '&lt;');
  const safe = esc(message);
  // The message usually leads with the actor's name; bold it and drop the
  // duplicate prefix. Plain string ops — the name is untrusted, so never build
  // a RegExp from it (special chars would throw).
  let rest = safe;
  if (actorName && rest.startsWith(actorName)) rest = rest.slice(actorName.length).replace(/^\s+/, '');
  const body = actorName ? `<strong>${esc(actorName)}</strong> ${rest}` : safe;
  return sendMail({
    to: recipient.email,
    subject: safe.slice(0, 120),
    html: shell('You have a new notification', `<p>${body}</p>`, url ? 'Open in Atlas' : null, url),
    text: `${safe}${url ? `\n\n${url}` : ''}`,
  });
}

module.exports = { sendMail, sendNotificationEmail, getOutbox: () => outbox, clearOutbox: () => { outbox.length = 0; } };
