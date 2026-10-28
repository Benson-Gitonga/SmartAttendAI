/**
 * Cloudflare Pages Function: forwards every /api/* request to the Tier 2
 * server on Render, so the PWA on Pages and its API share one address. The
 * app, its service worker and the offline sync queue all call relative /api
 * paths, so nothing in src/ needs to know where the server lives.
 *
 * Set API_ORIGIN in the Pages project (e.g. https://smartattend.onrender.com).
 */
export async function onRequest({ request, env }) {
  if (!env.API_ORIGIN) {
    return Response.json({ error: 'API_ORIGIN is not set on this Pages project' }, { status: 502 });
  }

  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.API_ORIGIN);

  const forwarded = new Request(target, request);
  forwarded.headers.set('X-Forwarded-Host', url.host);
  forwarded.headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp) forwarded.headers.set('X-Forwarded-For', clientIp);

  try {
    return await fetch(forwarded, { redirect: 'manual' });
  } catch {
    // Render's free plan sleeps; the first request after a while can fail.
    return Response.json({ error: 'the server could not be reached, try again shortly' }, { status: 502 });
  }
}
