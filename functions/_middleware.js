// Auth gate for the whole portal (replaces Cloudflare Access).
//
// Every request passes through here:
//   1. The `cf-access-authenticated-user-email` header is ALWAYS stripped from the
//      incoming request — after Access is removed, nothing external may set it.
//   2. If a valid bl_session cookie is present, the header is re-injected with the
//      session's email. Existing API functions keep reading the same header and
//      need no changes.
//   3. No session → API calls get 401; page loads redirect to /login.
//
// Public (no session needed): /login, /api/auth/*, /brand/*.

import { getSessionEmailFromCookie } from './_lib/session.js';

const PUBLIC_PREFIXES = ['/api/auth/', '/brand/'];
const PUBLIC_PATHS = ['/login', '/login.html', '/favicon.ico'];

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  const isPublic =
    PUBLIC_PATHS.includes(path) || PUBLIC_PREFIXES.some(p => path.startsWith(p));

  const email = await getSessionEmailFromCookie(request, env);

  // Logged-in users who hit /login go straight to the portal.
  if (email && (path === '/login' || path === '/login.html')) {
    return Response.redirect(url.origin + '/', 302);
  }

  // Always rebuild headers so a spoofed identity header can never get through.
  const headers = new Headers(request.headers);
  headers.delete('cf-access-authenticated-user-email');
  if (email) headers.set('cf-access-authenticated-user-email', email);

  if (!email && !isPublic) {
    if (path.startsWith('/api/')) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const nextParam = path !== '/' ? `?next=${encodeURIComponent(path)}` : '';
    return Response.redirect(`${url.origin}/login${nextParam}`, 302);
  }

  return next(new Request(request, { headers }));
}
