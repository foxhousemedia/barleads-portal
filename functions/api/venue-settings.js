// GET /api/venue-settings → the logged-in venue's own settings ({website})
// PUT /api/venue-settings → venue sets its own website URL.
//   Entering a website (with no ready brand guide yet) flags the account for
//   brand-guide generation — same trigger as when Kevin sets it in /admin.

import { normalizeUrl } from './admin.js';

function getEmail(request) {
  const email = request.headers.get('cf-access-authenticated-user-email');
  return email ? email.toLowerCase() : null;
}

export async function onRequestGet({ request, env }) {
  const email = getEmail(request);
  if (!email) return new Response('Unauthorized', { status: 401 });
  const row = await env.DB.prepare('SELECT website FROM venues WHERE email = ?').bind(email).first();
  return Response.json({ website: row?.website || null });
}

export async function onRequestPut({ request, env }) {
  const email = getEmail(request);
  if (!email) return new Response('Unauthorized', { status: 401 });

  let body;
  try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const url = normalizeUrl(body.website);
  if (url === undefined) return Response.json({ error: 'invalid_website' }, { status: 400 });

  const existing = await env.DB.prepare('SELECT email, brand FROM venues WHERE email = ?').bind(email).first();
  if (!existing) {
    // First touch: create the venue row so the website lands somewhere.
    await env.DB.prepare(`INSERT INTO venues (email, data, website) VALUES (?, '{}', ?)`).bind(email, url).run();
  }

  let hasBrand = false;
  try { hasBrand = existing?.brand && JSON.parse(existing.brand).status === 'ready'; } catch {}

  if (url && !hasBrand) {
    await env.DB.prepare('UPDATE venues SET website = ?, brand = ? WHERE email = ?')
      .bind(url, JSON.stringify({ status: 'pending', source_url: url, requested_by: email, requested_at: new Date().toISOString() }), email)
      .run();
  } else {
    await env.DB.prepare('UPDATE venues SET website = ? WHERE email = ?').bind(url, email).run();
  }

  return Response.json({ ok: true, website: url, brand_generation: url && !hasBrand ? 'queued' : 'unchanged' });
}
