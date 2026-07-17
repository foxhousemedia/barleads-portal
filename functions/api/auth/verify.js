// POST /api/auth/verify  { email, code }
//
// Checks the newest unused, unexpired code for the email. 5 wrong attempts
// burn the code (request a new one). Success sets the bl_session cookie and
// tells the frontend where to land (/admin for admin-only accounts, / for venues).

import {
  hashCode, createSessionToken, sessionCookieHeader, isAdminEmail,
} from '../../_lib/session.js';

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }

  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();
  if (!email || !/^\d{6}$/.test(code)) {
    return Response.json({ error: 'invalid_code' }, { status: 400 });
  }

  const row = await env.DB
    .prepare(`SELECT id, code_hash, attempts FROM login_codes
              WHERE email = ? AND used = 0 AND expires_at > datetime('now')
              ORDER BY id DESC LIMIT 1`)
    .bind(email)
    .first();

  if (!row) return Response.json({ error: 'expired' }, { status: 400 });

  if (row.attempts >= 5) {
    await env.DB.prepare('UPDATE login_codes SET used = 1 WHERE id = ?').bind(row.id).run();
    return Response.json({ error: 'too_many_attempts' }, { status: 429 });
  }

  // Count the attempt before comparing.
  await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();

  const candidate = await hashCode(code, env);
  if (candidate !== row.code_hash) {
    return Response.json({ error: 'wrong_code' }, { status: 400 });
  }

  await env.DB.prepare('UPDATE login_codes SET used = 1 WHERE id = ?').bind(row.id).run();

  const token = await createSessionToken(email, env);

  // Admin-only accounts (no venue row) land on /admin; venues land on the portal.
  const venue = await env.DB.prepare('SELECT email FROM venues WHERE email = ?').bind(email).first();
  const redirect = !venue && isAdminEmail(email, env) ? '/admin' : '/';

  return Response.json(
    { ok: true, redirect },
    { headers: { 'Set-Cookie': sessionCookieHeader(token) } }
  );
}
