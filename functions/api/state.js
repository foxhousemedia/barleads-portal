// GET /api/state  → the logged-in venue's saved portal state (or null)
// PUT /api/state  → save the venue's portal state (JSON body)
//
// Identity comes from Cloudflare Access: once the Pages project is protected by
// an Access application, every request carries the authenticated user's email in
// the `cf-access-authenticated-user-email` header. Requests that bypass Access
// (shouldn't be possible when the Access app covers the whole hostname) have no
// header and get a 401.

function getEmail(request) {
  const email = request.headers.get('cf-access-authenticated-user-email');
  return email ? email.toLowerCase() : null;
}

export async function onRequestGet({ request, env }) {
  const email = getEmail(request);
  if (!email) return new Response('Unauthorized', { status: 401 });

  const row = await env.DB
    .prepare('SELECT data FROM venues WHERE email = ?')
    .bind(email)
    .first();

  return Response.json(row ? JSON.parse(row.data) : null);
}

export async function onRequestPut({ request, env }) {
  const email = getEmail(request);
  if (!email) return new Response('Unauthorized', { status: 401 });

  const body = await request.text();
  if (body.length > 2_000_000) return new Response('Payload too large', { status: 413 });

  try {
    JSON.parse(body); // validate it's real JSON before storing
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  await env.DB
    .prepare(
      `INSERT INTO venues (email, data, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(email) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    )
    .bind(email, body)
    .run();

  return Response.json({ ok: true });
}
