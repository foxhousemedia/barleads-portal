// Newsletter renderer — turns venue data + brand guide into the branded email HTML.
// Layout per Kevin's spec: header (logo + sourced tagline) → stripe divider → events
// (ticket CTA only when a ticket URL exists) → weekly specials (fixed visuals) →
// happy hour block at the very bottom (See More Info only when a URL exists) → footer.
// Preview mode adds the "Do you want to add?" grayed suggestions + edits button.

const OCC_NAMES = {
  newyearsday: "New Year's Day Recovery", cfpchamp: 'College Football Championship',
  dryjan: 'Dry January Feature', superbowl: 'Super Bowl Sunday', galentines: "Galentine's Day",
  valentines: "Valentine's Day", mardigras: 'Mardi Gras', stpaddys: "St. Patrick's Day",
  marchmadness: 'March Madness Opening Weekend', springday: 'Patio Opening',
  openingday: 'MLB Opening Day', easterbrunch: 'Easter Weekend Brunch', cinco: 'Cinco de Mayo',
  derby: 'Kentucky Derby', memorial: 'Memorial Day Weekend', mothersday: "Mother's Day Brunch",
  pride: 'Pride Celebration', fathersday: "Father's Day", summerkick: 'Summer Kickoff',
  july4: 'Fourth of July', endsummer: 'End-of-Summer Bash', laborday: 'Labor Day Weekend',
  nflkickoff: 'NFL Kickoff', oktoberfest: 'Oktoberfest Kickoff', oktoberfin: 'Oktoberfest Finale',
  worldseries: 'World Series Watch Party', halloween: 'Halloween',
  friendsgiving: 'Friendsgiving', blackoutwed: 'Thanksgiving Eve ("Blackout Wednesday")',
  uglysweater: 'Ugly Sweater Party', xmaseveeve: 'Christmas Eve Eve', nye: "New Year's Eve",
  // legacy ids kept so old data still renders
  fourtwenty: '4/20', tequiladay: 'National Tequila Day', xmasjuly: 'Christmas in July',
  ipaday: 'National IPA Day', rumday: 'National Rum Day', veterans: 'Veterans Day',
};
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function occName(vid) {
  const m = vid.match(/^(.*?)-(actual|fri|sat)$/);
  const base = m ? m[1] : vid, suf = m ? m[2] : null;
  const name = OCC_NAMES[base] || base;
  if (suf === 'actual') return name;
  if (suf === 'fri') return name + ' Friday';
  if (suf === 'sat') return name + ' Saturday';
  return name;
}

const fmtDate = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
};

function normUrl(u) { return /^https?:\/\//i.test(u) ? u : 'https://' + u; }

// Collect the venue's events inside [start, end] (ISO date strings).
export function eventsInWindow(data, startIso, endIso) {
  const out = [];
  Object.entries(data.monthly || {}).forEach(([k, e]) => {
    if (!e || !e.inc || !e.date) return;
    if (e.date >= startIso && e.date <= endIso) {
      out.push({ name: occName(k.slice(k.indexOf(':') + 1)), date: e.date, ticket: e.ticket || null, items: e.items || [], media: e.media || [] });
    }
  });
  Object.values(data.customs || {}).forEach(list => (list || []).forEach(c => {
    if (c.date && c.date >= startIso && c.date <= endIso) {
      out.push({ name: c.name || 'Special Event', date: c.date, ticket: c.ticket || null, items: c.items || [], media: c.media || [] });
    }
  }));
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function renderNewsletter({ venue, mode = 'final', edition, sendDateIso, origin }) {
  const brand = venue.brand && venue.brand.status === 'ready' ? venue.brand : null;
  const data = venue.data || {};
  const c = brand?.colors || {};
  const dark = (brand?.mode || 'dark') === 'dark';

  // Palette with sane fallbacks
  const bg = c.bg_dark || (dark ? '#1c1d24' : '#f4f4f4');
  const card = c.card_dark || c.bg_card || (dark ? '#2a2b36' : '#ffffff');
  const cardBorder = c.card_border || (dark ? '#3d3e4d' : '#e5e5e5');
  const accent = c.accent || '#e8a13d';
  const txt = dark ? (c.text_on_dark || '#ffffff') : (c.text_on_light || '#222222');
  const muted = c.muted_on_dark || (dark ? '#b9bccb' : '#666666');
  const font = brand?.typography?.email_font_stack || 'Helvetica, Arial, sans-serif';
  const align = 'center';
  const btn = brand?.buttons?.primary || { bg: accent, color: '#1c1d24', radius: '0px', border: `2px solid ${accent}` };
  const stripe = c.sunset_amber && c.sunset_orange
    ? `background:linear-gradient(90deg,${accent},${c.sunset_amber},${c.sunset_orange});`
    : `background:${accent};`;
  const name = brand?.venue_display_name || venue.venue_name || venue.email;
  const tagline = brand?.taglines?.[0]?.text || '';

  const end = new Date(sendDateIso + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 37);
  const endIso = end.toISOString().slice(0, 10);
  const events = eventsInWindow(data, sendDateIso, endIso);

  const ctaStyle = `display:inline-block;background:${btn.bg};color:${btn.color};border:${btn.border || 'none'};border-radius:${btn.radius || '0px'};padding:10px 36px;font-weight:bold;text-decoration:none;font-size:14px;`;

  const eventCard = ev => {
    const img = (ev.media || []).find(m => m.type === 'image' && m.src);
    const details = (ev.items || []).map(it => [it.title, it.details].filter(Boolean).join(' — ')).filter(Boolean);
    return `<div style="background:${card};border:1px solid ${cardBorder};margin:0 18px 16px;padding:0 0 18px;text-align:${align};">
      ${img ? `<img src="${esc(img.src)}" alt="" width="100%" style="display:block;width:100%;max-height:260px;object-fit:cover;margin-bottom:14px;">` : '<div style="height:16px"></div>'}
      <div style="color:${accent};font-size:12px;text-transform:uppercase;letter-spacing:2px;font-weight:bold;">${esc(fmtDate(ev.date))}</div>
      <div style="color:${txt};font-size:18px;font-weight:bold;margin:6px 12px;">${esc(ev.name)}</div>
      ${details.map(d => `<div style="color:${muted};font-size:14px;line-height:1.55;margin:0 22px 4px;">${esc(d)}</div>`).join('')}
      ${ev.ticket ? `<div style="margin-top:12px;"><a href="${esc(normUrl(ev.ticket))}" style="${ctaStyle}">Get Tickets</a></div>` : ''}
    </div>`;
  };

  // Weekly specials: day-grouped one-liners with their fixed visual
  const specials = [];
  Object.entries(data.weekly || {}).forEach(([di, items]) => (items || []).forEach(it => {
    if (it.title) specials.push({ day: DAYS[Number(di)] ?? '', title: it.title, details: it.details || '', img: it.img || null });
  }));
  const specialCard = sp => `<td width="50%" style="padding:0 6px;vertical-align:top;">
    <div style="background:${card};border:1px solid ${cardBorder};text-align:${align};padding-bottom:12px;">
      ${sp.img ? `<img src="${esc(sp.img)}" alt="" width="100%" style="display:block;width:100%;aspect-ratio:1/1;object-fit:cover;border-bottom:3px solid ${accent};margin-bottom:8px;">` : `<div style="height:10px"></div>`}
      <div style="color:${accent};font-size:11px;text-transform:uppercase;letter-spacing:2px;font-weight:bold;">${esc(sp.day)}s</div>
      <div style="color:${txt};font-size:14.5px;font-weight:bold;margin:3px 8px;">${esc(sp.title)}</div>
      ${sp.details ? `<div style="color:${muted};font-size:12px;line-height:1.5;padding:0 10px;">${esc(sp.details)}</div>` : ''}
    </div></td>`;
  let specialsHtml = '';
  if (specials.length) {
    const rows = [];
    for (let i = 0; i < specials.length; i += 2) {
      rows.push(`<tr>${specialCard(specials[i])}${specials[i + 1] ? specialCard(specials[i + 1]) : '<td width="50%"></td>'}</tr>`);
    }
    specialsHtml = `<div style="color:${accent};text-align:center;font-size:15px;font-style:italic;padding:8px 24px 12px;">— And don&#39;t forget about our weekly specials —</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:0 12px;">${rows.join('')}</table>`;
  }

  // Happy hour — bottom block; button ONLY if a URL exists
  const hh = data.happyHour || {};
  const hhHtml = (hh.text || hh.url) ? `<div style="border-top:1px solid ${cardBorder};margin-top:16px;padding:20px 24px 8px;text-align:center;">
      <div style="color:${accent};font-size:15px;letter-spacing:2px;text-transform:uppercase;">Happy Hour</div>
      ${hh.text ? `<div style="color:${txt};font-size:15px;margin-top:8px;white-space:pre-line;">${esc(hh.text)}</div>` : ''}
      ${hh.url ? `<div style="margin-top:12px;"><a href="${esc(normUrl(hh.url))}" style="${ctaStyle}font-size:12.5px;padding:8px 28px;">See More Info</a></div>` : ''}
    </div>` : '';

  // Preview extras: grayed "Do you want to add?" + edits button
  let previewTop = '', previewBottom = '';
  if (mode === 'preview') {
    const pend = (venue.suggestions || []).filter(s => s.status === 'pending');
    previewTop = `<div style="background:#fff4d6;color:#7a5d00;font-family:Helvetica,Arial,sans-serif;font-size:13px;padding:12px 18px;text-align:center;">
      <b>PREVIEW</b> — this is how your ${esc(name)} newsletter is currently looking. It sends <b>${esc(fmtDate(sendDateIso))}</b>.</div>`;
    previewBottom = `${pend.length ? `
      <div style="border-top:2px dashed ${cardBorder};margin-top:18px;padding-top:16px;">
      <div style="color:${txt};text-align:center;font-size:16px;font-weight:bold;padding:0 24px 4px;">Do you want to add?</div>
      <div style="color:${muted};text-align:center;font-size:12.5px;padding:0 30px 14px;">We spotted these on your website &amp; socials — one click in the portal adds them.</div>
      ${pend.map(s => `<div style="opacity:.55;background:${card};border:1px dashed ${cardBorder};margin:0 18px 12px;padding:0 0 14px;text-align:center;">
        ${s.img ? `<img src="${esc(s.img)}" alt="" width="100%" style="display:block;width:100%;max-height:200px;object-fit:cover;margin-bottom:12px;filter:grayscale(35%);">` : '<div style="height:12px"></div>'}
        <div style="color:${accent};font-size:11.5px;text-transform:uppercase;letter-spacing:2px;font-weight:bold;">${esc(fmtDate(s.date))}</div>
        <div style="color:${txt};font-size:16px;font-weight:bold;margin:4px 12px;">${esc(s.title)}</div>
        ${s.desc ? `<div style="color:${muted};font-size:13px;margin:0 22px;">${esc(s.desc)}</div>` : ''}
      </div>`).join('')}</div>` : ''}
      <div style="text-align:center;padding:20px 24px 8px;">
        <a href="${esc(origin)}/" style="${ctaStyle}">Click Here To Make Edits</a>
      </div>`;
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e9e9ee;">
${previewTop}
<div style="max-width:480px;margin:0 auto;background:${bg};font-family:${font};">
  <div style="text-align:center;padding:28px 20px 18px;">
    ${brand?.logo_url ? `<img src="${esc(brand.logo_url)}" alt="${esc(name)}" width="84" style="width:84px;height:84px;border-radius:50%;">` : ''}
    <div style="color:${accent};font-size:22px;letter-spacing:1.5px;margin-top:10px;">${esc(name.toUpperCase())}</div>
    ${tagline ? `<div style="color:${muted};font-size:12.5px;font-style:italic;margin-top:4px;">${esc(tagline)}</div>` : ''}
  </div>
  <div style="height:5px;${stripe}"></div>
  <div style="color:${txt};text-align:center;font-size:19px;padding:22px 24px 6px;">What&#39;s On</div>
  <div style="color:${muted};text-align:center;font-size:13.5px;padding:0 30px 18px;line-height:1.6;">Here&#39;s what&#39;s coming up — see you there.</div>
  ${events.length ? events.map(eventCard).join('') : `<div style="color:${muted};text-align:center;font-size:13.5px;padding:0 30px 18px;">(No dated events in this window yet.)</div>`}
  ${specialsHtml}
  ${hhHtml}
  ${previewBottom}
  <div style="color:${muted};text-align:center;font-size:11px;padding:20px 24px 26px;line-height:1.7;">
    ${esc(name)}${brand?.location ? ' · ' + esc(brand.location) : ''}<br>
    You&#39;re receiving this because you snapped a pic in our photobooth 📸<br>
    <a href="#" style="color:${accent};">Unsubscribe</a>${venue.website ? ` · <a href="${esc(venue.website)}" style="color:${accent};">${esc(venue.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : ''}
  </div>
</div>
</body></html>`;

  return { html, eventCount: events.length, suggestionCount: (venue.suggestions || []).filter(s => s.status === 'pending').length };
}
