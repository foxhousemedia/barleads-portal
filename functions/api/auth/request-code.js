// POST /api/auth/request-code  { email }
//
// The whole reason this custom login exists: if the email has no account,
// say so IMMEDIATELY ({ error: 'no_account' }, 404) instead of letting the
// user wait for an email that will never arrive.
//
// An account exists if the email is a venue row in D1 OR is in ADMIN_EMAILS.
// Valid accounts get a 6-digit code (10-min expiry, single-use, hashed at rest)
// sent via Resend. Rate limits: 3 codes / 15 min per email, 10 / 15 min per IP.
//
// DEV_ECHO_CODES=true (preview environment ONLY — never production) returns the
// code in the response so the flow can be tested before Resend is wired up.

import { hashCode, isAdminEmail } from '../../_lib/session.js';

function generateCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }

  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: 'invalid_email' }, { status: 400 });
  }

  // --- The instant feedback check ---
  const venue = await env.DB
    .prepare('SELECT email FROM venues WHERE email = ?')
    .bind(email)
    .first();
  if (!venue && !isAdminEmail(email, env)) {
    return Response.json({ error: 'no_account' }, { status: 404 });
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';

  // Rate limits (count rows created in the last 15 minutes).
  const emailCount = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > datetime('now', '-15 minutes')`)
    .bind(email)
    .first();
  if (emailCount.n >= 3) return Response.json({ error: 'rate_limited' }, { status: 429 });

  const ipCount = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM login_codes WHERE ip = ? AND created_at > datetime('now', '-15 minutes')`)
    .bind(ip)
    .first();
  if (ipCount.n >= 10) return Response.json({ error: 'rate_limited' }, { status: 429 });

  // New code invalidates any previous unused ones for this email.
  await env.DB.prepare('UPDATE login_codes SET used = 1 WHERE email = ? AND used = 0').bind(email).run();

  const code = generateCode();
  const codeHash = await hashCode(code, env);
  await env.DB
    .prepare(`INSERT INTO login_codes (email, code_hash, ip, expires_at) VALUES (?, ?, ?, datetime('now', '+10 minutes'))`)
    .bind(email, codeHash, ip)
    .run();

  // Occasional cleanup so the table never grows unbounded.
  if (Math.random() < 0.05) {
    await env.DB.prepare(`DELETE FROM login_codes WHERE created_at < datetime('now', '-1 day')`).run();
  }

  if (env.DEV_ECHO_CODES === 'true') {
    return Response.json({ ok: true, dev_code: code });
  }

  if (!env.RESEND_API_KEY) {
    return Response.json({ error: 'send_not_configured' }, { status: 500 });
  }

  const from = env.MAIL_FROM || 'BarLeads <login@bar-leads.com>';
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `${code} is your BarLeads login code`,
      text: `Your BarLeads Client Portal login code is: ${code}\n\nIt expires in 10 minutes. If you didn't request this, you can ignore this email.`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px">
        <div style="font-weight:700;font-size:18px;margin-bottom:16px">Bar<span style="color:#e8890c">Leads</span> Client Portal</div>
        <p style="color:#374151;font-size:14px">Here's your login code:</p>
        <div style="font-size:32px;font-weight:800;letter-spacing:8px;background:#f4f5f7;border-radius:12px;padding:16px 0;text-align:center;color:#16181d">${code}</div>
        <p style="color:#6b7280;font-size:12px;margin-top:16px">It expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
      </div>`,
    }),
  });

  if (!resp.ok) {
    return Response.json({ error: 'send_failed' }, { status: 502 });
  }

  return Response.json({ ok: true });
}
