/**
 * Relé de WhatsApp → Apps Script (Cloudflare Workers).
 *
 * Meta envía cada evento aquí. El relé:
 *   1. responde a la verificación del webhook (GET con hub.challenge),
 *   2. revisa la firma X-Hub-Signature-256 con el App Secret de Meta (cuerpo crudo, comparación en tiempo constante),
 *   3. descarta eventos de otros números (WA_PHONE_ID) y los avisos de entrega que no sirven (solo pasan los "failed"),
 *   4. responde 200 rápido (Meta reintenta si tardamos) y
 *   5. reenvía el evento a Apps Script con RELAY_SECRET:
 *        - con la cola QUEUE (recomendado): durable, con reintentos y cola de errores;
 *        - sin cola: hasta 3 intentos en segundo plano.
 *
 * GET /health revisa la configuración y la salud de Apps Script (para un monitor externo).
 *
 * Variables (wrangler secret put …): VERIFY_TOKEN, APP_SECRET, APPS_SCRIPT_URL, RELAY_SECRET
 * Opcionales: WA_PHONE_ID (solo este número), HEALTH_KEY (igual a la de Apps Script)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') return health(env);

    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge') || '';
      if (mode === 'subscribe' && env.VERIFY_TOKEN && safeEqual(token || '', env.VERIFY_TOKEN)) {
        return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      return new Response('Forbidden', { status: 403 });
    }

    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const raw = await request.text();
    const ok = await validSignature(raw, request.headers.get('X-Hub-Signature-256'), env.APP_SECRET);
    if (!ok) {
      console.warn('Firma inválida desde ' + (request.headers.get('CF-Connecting-IP') || '?'));
      return new Response('Invalid signature', { status: 401 });
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      return new Response('Bad Request', { status: 400 });
    }

    const relevant = relevantEvents(payload, env.WA_PHONE_ID);
    if (!relevant) return new Response('OK', { status: 200 });

    if (env.QUEUE) {
      // Si la cola no acepta el evento, devolvemos 500 para que Meta lo reintente (no se pierde).
      try {
        await env.QUEUE.send(relevant);
      } catch (err) {
        console.error('Cola: ' + err);
        return new Response('Retry later', { status: 500 });
      }
    } else {
      ctx.waitUntil(forwardWithRetry(env, relevant));
    }
    return new Response('OK', { status: 200 });
  },

  /** Consumidor de la cola: reenvía; si Apps Script falla, la cola reintenta con espera. */
  async queue(batch, env) {
    for (const message of batch.messages) {
      const delivered = await forward(env, message.body);
      if (delivered) message.ack();
      else message.retry({ delaySeconds: Math.min(300, 15 * Math.pow(2, message.attempts || 0)) });
    }
  }
};

/**
 * Deja solo lo que Apps Script necesita: mensajes, ecos de la app (smb_message_echoes)
 * y estados "failed", de nuestro número. Devuelve null si no queda nada.
 */
export function relevantEvents(payload, phoneId) {
  const entry = [];
  for (const e of payload.entry || []) {
    const changes = [];
    for (const c of e.changes || []) {
      const v = c.value || {};
      if (phoneId && v.metadata && v.metadata.phone_number_id && String(v.metadata.phone_number_id) !== String(phoneId)) continue;
      const messages = v.messages || [];
      const echoes = v.message_echoes || [];
      const failed = (v.statuses || []).filter((s) => s.status === 'failed');
      if (!messages.length && !echoes.length && !failed.length) continue;
      const value = Object.assign({}, v, { statuses: failed });
      changes.push(Object.assign({}, c, { value }));
    }
    if (changes.length) entry.push(Object.assign({}, e, { changes }));
  }
  return entry.length ? Object.assign({}, payload, { entry }) : null;
}

/** Compatibilidad: ¿trae mensajes? */
export function hasMessages(payload) {
  return (payload.entry || []).some((e) => (e.changes || []).some((c) => ((c.value && c.value.messages) || []).length > 0));
}

/** Envía a Apps Script. true si respondió { ok: true }. */
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
    if (!res.ok || !/"ok"\s*:\s*true/.test(text)) {
      console.error('Apps Script respondió ' + res.status + ': ' + text.slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error('No se pudo reenviar a Apps Script: ' + err);
    return false;
  }
}

/** Sin cola: 3 intentos (0 s, 2 s, 6 s). */
export async function forwardWithRetry(env, payload, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const waits = [0, 2000, 6000];
  for (const w of waits) {
    if (w) await sleep(w);
    if (await forward(env, payload)) return true;
  }
  console.error('Evento perdido tras 3 intentos (activa la cola QUEUE para no perder mensajes).');
  return false;
}

async function health(env) {
  const out = {
    ok: true,
    relay: 'ok',
    config: ['VERIFY_TOKEN', 'APP_SECRET', 'APPS_SCRIPT_URL', 'RELAY_SECRET'].filter((k) => !env[k]),
    cola: env.QUEUE ? 'activa' : 'sin cola'
  };
  if (out.config.length) out.ok = false;
  if (env.APPS_SCRIPT_URL) {
    try {
      const u = new URL(env.APPS_SCRIPT_URL);
      u.searchParams.set('action', 'salud');
      if (env.HEALTH_KEY) u.searchParams.set('clave', env.HEALTH_KEY);
      const res = await fetch(u.toString(), { redirect: 'follow' });
      const body = await res.json();
      out.apps_script = body;
      if (!body.ok) out.ok = false;
    } catch (err) {
      out.ok = false;
      out.apps_script = 'error: ' + String(err).slice(0, 100);
    }
  }
  return new Response(JSON.stringify(out), { status: out.ok ? 200 : 503, headers: { 'Content-Type': 'application/json' } });
}

function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function validSignature(raw, header, appSecret) {
  if (!appSecret || !header || !header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return safeEqual(header.slice(7).toLowerCase(), expected);
}
