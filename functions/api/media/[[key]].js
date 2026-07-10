// GET /api/media/<venue-email>/<file-key>  → streams the object from R2
// DELETE same path → removes it
// Venues can only read/delete their own media (key must start with their email).
// Exception: ADMIN_EMAILS may READ any venue's media (for the /admin view) — never delete.

import { isAdmin } from '../admin.js';

function getEmail(request) {
  const email = request.headers.get('cf-access-authenticated-user-email');
  return email ? email.toLowerCase() : null;
}

function getKey(params) {
  return Array.isArray(params.key) ? params.key.join('/') : params.key;
}

export async function onRequestGet({ request, params, env }) {
  const email = getEmail(request);
  if (!email) return new Response('Unauthorized', { status: 401 });

  const key = getKey(params);
  if (!key.startsWith(email + '/') && !isAdmin(email, env)) return new Response('Forbidden', { status: 403 });

  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
}

export async function onRequestDelete({ request, params, env }) {
  const email = getEmail(request);
  if (!email) return new Response('Unauthorized', { status: 401 });

  const key = getKey(params);
  if (!key.startsWith(email + '/')) return new Response('Forbidden', { status: 403 });

  await env.MEDIA.delete(key);
  return Response.json({ ok: true });
}
