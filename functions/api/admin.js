// GET /api/admin → every venue's saved state + brand/newsletter fields + submissions log.
// PUT /api/admin → admin writes, all optional per call: {email, name?, website?, dropbox_url?, brand?}
//   - name: venue display label
//   - website: venue's public site (triggers brand-guide generation when brand is empty)
//   - dropbox_url: Kevin's Dropbox folder of venue assets (photos/video from shoots)
//   - brand: the brand-guide JSON (object or JSON string) — auto-generated, admin-editable
// Only emails in env.ADMIN_EMAILS get in; everyone else 403s.

function getEmail(request) {
  const email = request.headers.get('cf-access-authenticated-user-email');
  return email ? email.toLowerCase() : null;
}

export function isAdmin(email, env) {
  if (!email || !env.ADMIN_EMAILS) return false;
  return env.ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase()).includes(email);
}

export function normalizeUrl(raw, { allowEmpty = true } = {}) {
  const s = String(raw ?? '').trim();
  if (!s) return allowEmpty ? null : undefined;      // null = clear the field
  const withProto = /^https?:\/\//i.test(s) ? s : 'https://' + s;
  try {
    const u = new URL(withProto);
    if (!u.hostname.includes('.')) return undefined; // not a real host
    return u.toString();
  } catch { return undefined; }                      // undefined = invalid
}

export async function onRequestGet({ request, env }) {
  const email = getEmail(request);
  if (!email) return new Response('Unauthorized', { status: 401 });
  if (!isAdmin(email, env)) return new Response('Forbidden', { status: 403 });

  const venues = await env.DB
    .prepare('SELECT email, venue_name, data, website, dropbox_url, brand, suggestions, updated_at FROM venues ORDER BY updated_at DESC')
    .all();
  const submissions = await env.DB
    .prepare('SELECT email, submitted_at FROM submissions ORDER BY submitted_at DESC LIMIT 200')
    .all();

  return Response.json({
    admin: email,
    venues: venues.results.map(v => {
      let data = null, brand = null, suggestions = [];
      try { data = JSON.parse(v.data); } catch {}
      try { brand = v.brand ? JSON.parse(v.brand) : null; } catch {}
      try { suggestions = v.suggestions ? JSON.parse(v.suggestions) : []; } catch {}
      return {
        email: v.email, venue_name: v.venue_name || null, updated_at: v.updated_at,
        website: v.website || null, dropbox_url: v.dropbox_url || null, brand, data, suggestions,
      };
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
  if (!target) return new Response('Missing email', { status: 400 });

  const existing = await env.DB
    .prepare('SELECT email, brand FROM venues WHERE email = ?')
    .bind(target)
    .first();
  if (!existing) return new Response('Venue not found', { status: 404 });

  const sets = [], binds = [];

  if ('name' in body) {
    const name = String(body.name || '').trim().slice(0, 80);
    sets.push('venue_name = ?'); binds.push(name || null);
  }
  if ('website' in body) {
    const url = normalizeUrl(body.website);
    if (url === undefined) return Response.json({ error: 'invalid_website' }, { status: 400 });
    sets.push('website = ?'); binds.push(url);
    // A new/changed website with no usable brand guide → flag it for generation.
    let hasBrand = false;
    try { hasBrand = existing.brand && JSON.parse(existing.brand).status === 'ready'; } catch {}
    if (url && !hasBrand) {
      sets.push('brand = ?');
      binds.push(JSON.stringify({ status: 'pending', source_url: url, requested_by: email, requested_at: new Date().toISOString() }));
    }
  }
  if ('dropbox_url' in body) {
    const url = normalizeUrl(body.dropbox_url);
    if (url === undefined) return Response.json({ error: 'invalid_dropbox_url' }, { status: 400 });
    sets.push('dropbox_url = ?'); binds.push(url);
  }
  if ('brand' in body) {
    let brandObj = body.brand;
    if (typeof brandObj === 'string') { try { brandObj = JSON.parse(brandObj); } catch { return Response.json({ error: 'invalid_brand_json' }, { status: 400 }); } }
    if (brandObj !== null && typeof brandObj !== 'object') return Response.json({ error: 'invalid_brand_json' }, { status: 400 });
    const s = brandObj ? JSON.stringify(brandObj) : null;
    if (s && s.length > 50_000) return Response.json({ error: 'brand_too_large' }, { status: 413 });
    sets.push('brand = ?'); binds.push(s);
  }

  if ('suggestion_add' in body || 'suggestion_del' in body) {
    const vrow = await env.DB.prepare('SELECT suggestions FROM venues WHERE email = ?').bind(target).first();
    let list = [];
    try { list = vrow?.suggestions ? JSON.parse(vrow.suggestions) : []; } catch {}
    if (body.suggestion_add) {
      const sa = body.suggestion_add;
      if (!sa.title || !/^\d{4}-\d{2}-\d{2}$/.test(sa.date || '')) return Response.json({ error: 'invalid_suggestion' }, { status: 400 });
      list.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title: String(sa.title).slice(0, 120), date: sa.date,
        desc: String(sa.desc || '').slice(0, 500), img: String(sa.img || '').slice(0, 2000) || null,
        ticket: String(sa.ticket || '').slice(0, 2000) || null,
        source: String(sa.source || 'admin').slice(0, 200),
        status: 'pending', created_at: new Date().toISOString(),
      });
    }
    if (body.suggestion_del) list = list.filter(x => x.id !== body.suggestion_del);
    sets.push('suggestions = ?'); binds.push(JSON.stringify(list));
  }

  if (!sets.length) return Response.json({ error: 'nothing_to_update' }, { status: 400 });

  binds.push(target);
  await env.DB.prepare(`UPDATE venues SET ${sets.join(', ')} WHERE email = ?`).bind(...binds).run();

  const row = await env.DB
    .prepare('SELECT email, venue_name, website, dropbox_url, brand FROM venues WHERE email = ?')
    .bind(target)
    .first();
  let brand = null; try { brand = row.brand ? JSON.parse(row.brand) : null; } catch {}
  return Response.json({ ok: true, email: row.email, name: row.venue_name || null, website: row.website, dropbox_url: row.dropbox_url, brand });
}
