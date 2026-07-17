// Event suggestions — staged by the T-3 scrape (or by Kevin in /admin) from events the
// venue has PUBLICLY ANNOUNCED (website/socials) but not entered in the portal.
//
// GET  /api/suggestions → the logged-in venue's pending suggestions
// POST /api/suggestions {id, action: 'accept'|'dismiss'}
//   accept  → converts the suggestion into a custom event (with its image) in the
//             venue's data blob, one click, and marks it added
//   dismiss → marks it dismissed (kept for the record, never re-suggested)
//
// Suggestion shape (stored as JSON array in venues.suggestions):
//   {id, title, date: 'YYYY-MM-DD', desc, img, ticket, source, status,
//    created_at, resolved_at}

function getEmail(request) {
  const email = request.headers.get('cf-access-authenticated-user-email');
  return email ? email.toLowerCase() : null;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export async function onRequestGet({ request, env }) {
  const email = getEmail(request);
  if (!email) return new Response('Unauthorized', { status: 401 });
  const row = await env.DB.prepare('SELECT suggestions FROM venues WHERE email = ?').bind(email).first();
  let all = [];
  try { all = row?.suggestions ? JSON.parse(row.suggestions) : []; } catch {}
  return Response.json({ suggestions: all.filter(s => s.status === 'pending') });
}

export async function onRequestPost({ request, env }) {
  const email = getEmail(request);
  if (!email) return new Response('Unauthorized', { status: 401 });

  let body;
  try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const { id, action } = body;
  if (!id || !['accept', 'dismiss'].includes(action)) return Response.json({ error: 'bad_request' }, { status: 400 });

  const row = await env.DB.prepare('SELECT data, suggestions FROM venues WHERE email = ?').bind(email).first();
  if (!row) return new Response('Venue not found', { status: 404 });

  let all = [];
  try { all = row.suggestions ? JSON.parse(row.suggestions) : []; } catch {}
  const s = all.find(x => x.id === id && x.status === 'pending');
  if (!s) return Response.json({ error: 'not_found' }, { status: 404 });

  let createdEvent = null;
  if (action === 'accept') {
    let data = {};
    try { data = JSON.parse(row.data) || {}; } catch {}
    const d = new Date(s.date + 'T12:00:00');
    if (isNaN(d)) return Response.json({ error: 'bad_suggestion_date' }, { status: 422 });
    const key = `${d.getFullYear()}:${d.getMonth()}`;
    data.customs ??= {};
    data.customs[key] ??= [];
    createdEvent = {
      id: uid(),
      name: s.title,
      date: s.date,
      ticket: s.ticket || undefined,
      items: s.desc ? [{ id: uid(), title: s.title, details: s.desc, img: '' }] : [],
      media: s.img ? [{ id: uid(), type: 'image', src: s.img }] : [],
      from_suggestion: s.id,
    };
    data.customs[key].push(createdEvent);
    await env.DB.prepare(`UPDATE venues SET data = ?, updated_at = datetime('now') WHERE email = ?`)
      .bind(JSON.stringify(data), email).run();
  }

  s.status = action === 'accept' ? 'added' : 'dismissed';
  s.resolved_at = new Date().toISOString();
  await env.DB.prepare('UPDATE venues SET suggestions = ? WHERE email = ?')
    .bind(JSON.stringify(all), email).run();

  return Response.json({ ok: true, status: s.status, event: createdEvent });
}
