// POST /api/auth/logout → clears the session cookie.

import { clearSessionCookieHeader } from '../../_lib/session.js';

export async function onRequestPost() {
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': clearSessionCookieHeader() } }
  );
}
