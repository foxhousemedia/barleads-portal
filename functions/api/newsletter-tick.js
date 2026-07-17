// The newsletter clock. A daily scheduled Claude session POSTs here (authenticated via
// session cookie or X-Automation-Secret, both resolved by the middleware into an admin
// identity). The endpoint does the deterministic date work:
//
//   T-3 before a send → reports which venues are due for the scrape-and-suggest pass
//                       (the CALLER does the scraping — this endpoint just flags it)
//   T-2 before a send → renders + emails the PREVIEW to the bar manager
//   T-0 (send day)    → renders + emails the newsletter. Until subscriber lists exist,
//                       this is a dress rehearsal: it goes to the venue manager + admins,
//                       logged as kind='send_dress_rehearsal'.
//
// Editions per month M: A = last Wednesday of M; B = A + 14 days.
// Every action is deduped via newsletter_log.
//
// GET  /api/newsletter-tick?venue=<email>&mode=preview|final  → rendered HTML (admin eyeball)
// POST /api/newsletter-tick {today?: 'YYYY-MM-DD', dry?: bool}

import { isAdmin } from './admin.js';
import { renderNewsletter } from '../_lib/newsletter.js';

function getEmail(request) {
  const email = request.headers.get('cf-access-authenticated-user-email');
  return email ? email.toLowerCase() : null;
}

function lastWednesdayIso(year, month) { // month 0-11, UTC
  const d = new Date(Date.UTC(year, month + 1, 0));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 4) % 7));
  return d.toISOString().slice(0, 10);
}
function addDaysIso(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function todayPacificIso() {
  // Good-enough Pacific date (fixed -7h; the tick runs mid-morning PT so DST wobble is harmless)
  return new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
}

// Send dates that could be "near" today: editions A & B for last, current and next month.
function candidateSends(todayIso) {
  const [y, m] = todayIso.split('-').map(Number);
  const out = [];
  for (const off of [-1, 0, 1]) {
    const d = new Date(Date.UTC(y, m - 1 + off, 1));
    const a = lastWednesdayIso(d.getUTCFullYear(), d.getUTCMonth());
    out.push({ edition: 'A', sendDate: a }, { edition: 'B', sendDate: addDaysIso(a, 14) });
  }
  return out;
}

async function loadVenues(env) {
  const rows = await env.DB.prepare('SELECT email, venue_name, data, website, dropbox_url, brand, suggestions FROM venues').all();
  return rows.results.map(v => {
    const parse = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };
    return { ...v, data: parse(v.data, {}), brand: parse(v.brand, null), suggestions: parse(v.suggestions, []) };
  });
}

async function alreadyLogged(env, email, edition, kind, sendDate) {
  const r = await env.DB.prepare('SELECT id FROM newsletter_log WHERE email = ? AND edition = ? AND kind = ? AND detail = ?')
    .bind(email, edition, kind, sendDate).first();
  return !!r;
}

async function log(env, email, edition, kind, sendDate) {
  await env.DB.prepare('INSERT INTO newsletter_log (email, edition, kind, detail) VALUES (?, ?, ?, ?)')
    .bind(email, edition, kind, sendDate).run();
}

async function sendEmail(env, { to, subject, html, fromName }) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'no_resend_key' };
  const from = fromName ? `${fromName.replace(/["<>]/g, '')} <newsletters@bar-leads.com>` : (env.MAIL_FROM || 'BarLeads <login@bar-leads.com>');
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  return { sent: resp.ok, status: resp.status };
}

export async function onRequestGet({ request, env }) {
  const email = getEmail(request);
  if (!email || !isAdmin(email, env)) return new Response('Forbidden', { status: 403 });
  const url = new URL(request.url);
  const target = (url.searchParams.get('venue') || '').toLowerCase();
  const mode = url.searchParams.get('mode') === 'final' ? 'final' : 'preview';
  const venues = await loadVenues(env);
  const venue = venues.find(v => v.email === target);
  if (!venue) return new Response('Venue not found', { status: 404 });
  const todayIso = url.searchParams.get('today') || todayPacificIso();
  const next = candidateSends(todayIso).filter(s => s.sendDate >= todayIso).sort((a, b) => a.sendDate.localeCompare(b.sendDate))[0];
  const { html } = renderNewsletter({ venue, mode, edition: next.edition, sendDateIso: next.sendDate, origin: url.origin });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost({ request, env }) {
  const email = getEmail(request);
  if (!email || !isAdmin(email, env)) return new Response('Forbidden', { status: 403 });

  let body = {};
  try { body = await request.json(); } catch {}
  const todayIso = body.today || todayPacificIso();
  const dry = !!body.dry || !env.RESEND_API_KEY;
  const origin = new URL(request.url).origin;
  const adminEmails = (env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);

  const sends = candidateSends(todayIso);
  const venues = await loadVenues(env);
  const actions = [];

  for (const venue of venues) {
    for (const s of sends) {
      const tMinus = (new Date(s.sendDate + 'T00:00:00Z') - new Date(todayIso + 'T00:00:00Z')) / 86400e3;

      if (tMinus === 3) {
        actions.push({ venue: venue.email, edition: s.edition, sendDate: s.sendDate, action: 'scrape_due', website: venue.website, instagram: venue.brand?.socials?.instagram || null });
      }

      if (tMinus === 2 && !(await alreadyLogged(env, venue.email, s.edition, 'preview', s.sendDate))) {
        const { html, eventCount, suggestionCount } = renderNewsletter({ venue, mode: 'preview', edition: s.edition, sendDateIso: s.sendDate, origin });
        let result = { sent: false, reason: 'dry_run' };
        if (!dry) {
          result = await sendEmail(env, {
            to: [venue.email], fromName: null,
            subject: `Your newsletter goes out ${s.sendDate} — here's how it's looking`,
            html,
          });
        }
        if (result.sent || dry) await log(env, venue.email, s.edition, 'preview', s.sendDate);
        actions.push({ venue: venue.email, edition: s.edition, sendDate: s.sendDate, action: 'preview', eventCount, suggestionCount, ...result });
      }

      if (tMinus === 0 && !(await alreadyLogged(env, venue.email, s.edition, 'send_dress_rehearsal', s.sendDate))) {
        const { html, eventCount } = renderNewsletter({ venue, mode: 'final', edition: s.edition, sendDateIso: s.sendDate, origin });
        const name = venue.brand?.venue_display_name || venue.venue_name || venue.email;
        let result = { sent: false, reason: 'dry_run' };
        if (!dry) {
          result = await sendEmail(env, {
            to: [...new Set([venue.email, ...adminEmails])], fromName: name,
            subject: `What's on at ${name}`,
            html,
          });
        }
        if (result.sent || dry) await log(env, venue.email, s.edition, 'send_dress_rehearsal', s.sendDate);
        actions.push({ venue: venue.email, edition: s.edition, sendDate: s.sendDate, action: 'send_dress_rehearsal', note: 'no subscriber list yet', eventCount, ...result });
      }
    }
  }

  return Response.json({ ok: true, today: todayIso, dry, actions });
}
