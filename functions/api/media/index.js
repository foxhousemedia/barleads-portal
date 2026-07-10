// POST /api/media  → upload one image/video to R2, returns { key, url }
// Body: the raw file. Headers: Content-Type (image/* or video/*), X-Filename (optional).
// Objects are namespaced per venue email so no venue can ever see another's media.

export async function onRequestPost({ request, env }) {
  const email = request.headers.get('cf-access-authenticated-user-email');
  if (!email) return new Response('Unauthorized', { status: 401 });

  const contentType = request.headers.get('content-type') || 'application/octet-stream';
  if (!/^(image|video)\//.test(contentType)) {
    return new Response('Unsupported type — images and video only', { status: 415 });
  }

  const size = Number(request.headers.get('content-length') || 0);
  if (size > 100_000_000) return new Response('File too large (100 MB max)', { status: 413 });

  const safeName = (request.headers.get('x-filename') || 'upload')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
  const key = `${email.toLowerCase()}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

  await env.MEDIA.put(key, request.body, {
    httpMetadata: { contentType },
  });

  return Response.json({ key, url: `/api/media/${key}` });
}
