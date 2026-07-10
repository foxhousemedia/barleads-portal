// POST /api/submit → log that this venue hit "Submit to BarLeads"
export async function onRequestPost({ request, env }) {
  const email = request.headers.get('cf-access-authenticated-user-email');
  if (!email) return new Response('Unauthorized', { status: 401 });

  await env.DB
    .prepare('INSERT INTO submissions (email) VALUES (?)')
    .bind(email.toLowerCase())
    .run();

  return Response.json({ ok: true });
}
