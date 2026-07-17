// Shared auth helpers: signed session cookies + one-time login code hashing.
//
// Sessions are stateless: base64url(payload).base64url(HMAC-SHA256(payload, AUTH_SECRET)).
// Payload: { e: email, x: expiryEpochSeconds }. No DB lookup needed per request.
// AUTH_SECRET is a Cloudflare Pages secret (never in git).

const COOKIE_NAME = 'bl_session';
const SESSION_DAYS = 30;

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeToString(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  );
}

export async function createSessionToken(email, env) {
  const payload = JSON.stringify({
    e: email.toLowerCase(),
    x: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  });
  const payloadB64 = b64url(enc.encode(payload));
  const key = await hmacKey(env.AUTH_SECRET);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  return `${payloadB64}.${b64url(sig)}`;
}

export async function verifySessionToken(token, env) {
  if (!token || !env.AUTH_SECRET) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  try {
    const key = await hmacKey(env.AUTH_SECRET);
    const expected = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
    if (b64url(expected) !== sigB64) return null; // constant-time enough: full-string compare of MACs
    const payload = JSON.parse(b64urlDecodeToString(payloadB64));
    if (!payload.e || !payload.x) return null;
    if (payload.x < Math.floor(Date.now() / 1000)) return null; // expired
    return payload.e;
  } catch {
    return null;
  }
}

export function getSessionEmailFromCookie(request, env) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifySessionToken(match[1], env); // returns a Promise<string|null>
}

export function sessionCookieHeader(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// One-time codes are stored as SHA-256(code + ':' + AUTH_SECRET) — never plaintext.
export async function hashCode(code, env) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${code}:${env.AUTH_SECRET}`));
  return b64url(digest);
}

export function isAdminEmail(email, env) {
  if (!email || !env.ADMIN_EMAILS) return false;
  return env.ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}
