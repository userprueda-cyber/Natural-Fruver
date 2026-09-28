/**
 * Relé de WhatsApp → Apps Script (Cloudflare Workers, plan gratuito).
 *
 * Meta envía cada mensaje aquí. El relé:
 *   1. responde a la verificación del webhook (GET con hub.challenge),
 *   2. revisa la firma X-Hub-Signature-256 con el App Secret de Meta,
 *   3. responde 200 de inmediato (Meta reintenta si tardamos) y
 *   4. reenvía el mensaje a la aplicación web de Apps Script con RELAY_SECRET.
 *
 * Variables (wrangler secret put …): VERIFY_TOKEN, APP_SECRET, APPS_SCRIPT_URL, RELAY_SECRET
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge') || '';
      if (mode === 'subscribe' && env.VERIFY_TOKEN && token === env.VERIFY_TOKEN) {
        return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      return new Response('Forbidden', { status: 403 });
    }

    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const raw = await request.text();
    const ok = await validSignature(raw, request.headers.get('X-Hub-Signature-256'), env.APP_SECRET);
    if (!ok) return new Response('Invalid signature', { status: 401 });

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      return new Response('Bad Request', { status: 400 });
    }

    // Los avisos de "entregado/leído" no se reenvían: no hay nada que hacer con ellos.
    if (hasMessages(payload)) ctx.waitUntil(forward(env, payload));
    return new Response('OK', { status: 200 });
  }
};

export function hasMessages(payload) {
  return (payload.entry || []).some((e) => (e.changes || []).some((c) => ((c.value && c.value.messages) || []).length > 0));
}

export async function forward(env, payload) {
  try {
    const res = await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      // text/plain: Apps Script lo lee como postData.contents sin preflight.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'wa_webhook', secret: env.RELAY_SECRET, payload }),
      redirect: 'follow'
    });
    const text = await res.text();
    if (!res.ok || !/"ok"\s*:\s*true/.test(text)) console.error('Apps Script respondió ' + res.status + ': ' + text.slice(0, 300));
  } catch (err) {
    console.error('No se pudo reenviar a Apps Script: ' + err);
  }
}

export async function validSignature(raw, header, appSecret) {
  if (!appSecret || !header || !header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice(7).toLowerCase();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
