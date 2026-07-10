// GET /api/admin → every venue's saved state + the submissions log.
// PUT /api/admin → set a venue's display name ({email, name}). The ONE admin write —
//   it touches a label Kevin owns, never the venue's own data.
// Only emails listed in env.ADMIN_EMAILS get in; everyone else sees 403,
// even though Cloudflare Access already let them onto the hostname.

function getEmail(request) {
  const email = request.headers.get('cf-access-authenticated-user-email');
  return email ? email.toLowerCase() : null;
}

export function isAdmin(email, env) {
  if (!email || !env.ADMIN_EMAILS) return false;
  return env.ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase()).includes(email);
}

export async function onRequestGet({ request, env }) {
  const email = getEmail(request);
  if (!email) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(email, env)) return new Response('Forbidden', { status: 403 });

  const venues = await env.DB
    .prepare('SELECT email, venue_name, data, updated_at FROM venues ORDER BY updated_at DESC')
    .all();
  const submissions = await env.DB
    .prepare('SELECT email, submitted_at FROM submissions ORDER BY submitted_at DESC LIMIT 200')
    .all();

  return Response.json({
    admin: email,
    venues: venues.results.map(v => {
      let data = null;
      try { data = JSON.parse(v.data); } catch {}
      return { email: v.email, venue_name: v.venue_name || null, updated_at: v.updated_at, data };
    }),
    submissions: submissions.results,
  });
}

export async function onRequestPut({ request, env }) {
  const email = getEmail(request);
  if (!email) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(email, env)) return new Response('Forbidden', { status: 403 });

  let body;
  try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const target = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 80);
  if (!target) return new Response('Missing email', { status: 400 });

  const res = await env.DB
    .prepare('UPDATE venues SET venue_name = ? WHERE email = ?')
    .bind(name || null, target)
    .run();
  if (!res.meta.changes) return new Response('Venue not found', { status: 404 });

  return Response.json({ ok: true, email: target, name: name || null });
}
