const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const env = { VERIFY_TOKEN: 'verify-me', APP_SECRET: 'app-secret', APPS_SCRIPT_URL: 'https://script.test/exec', RELAY_SECRET: 'relay' };
const load = () => import('../relay/worker.js');

function signed(body, secret = env.APP_SECRET) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function ctx() {
  const waits = [];
  return { waits, waitUntil: (p) => waits.push(p) };
}

const withMessage = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'm1', from: '57300', type: 'text', text: { body: 'hola' } }] } }] }] });
const onlyStatus = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'm1', status: 'read' }] } }] }] });

test('webhook verification answers the challenge only with the right token', async () => {
  const { default: worker } = await load();
  const ok = await worker.fetch(new Request('https://relay.test/?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=123'), env, ctx());
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '123');
  const bad = await worker.fetch(new Request('https://relay.test/?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=123'), env, ctx());
  assert.equal(bad.status, 403);
});

test('messages with a valid signature are forwarded to Apps Script with the relay secret', async () => {
  const { default: worker } = await load();
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return new Response('{"ok":true}'); };
  try {
    const c = ctx();
    const res = await worker.fetch(new Request('https://relay.test/', {
      method: 'POST', body: withMessage, headers: { 'X-Hub-Signature-256': signed(withMessage) }
    }), env, c);
    assert.equal(res.status, 200);
    await Promise.all(c.waits);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, env.APPS_SCRIPT_URL);
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.action, 'wa_webhook');
    assert.equal(body.secret, 'relay');
    assert.equal(body.payload.entry[0].changes[0].value.messages[0].id, 'm1');

    const c2 = ctx();
    await worker.fetch(new Request('https://relay.test/', {
      method: 'POST', body: onlyStatus, headers: { 'X-Hub-Signature-256': signed(onlyStatus) }
    }), env, c2);
    assert.equal(c2.waits.length, 0, 'status updates are not forwarded');
  } finally {
    global.fetch = realFetch;
  }
});

test('bad or missing signatures are rejected', async () => {
  const { default: worker } = await load();
  for (const header of [signed(withMessage, 'wrong'), 'sha256=abc', null]) {
    const headers = header ? { 'X-Hub-Signature-256': header } : {};
    const res = await worker.fetch(new Request('https://relay.test/', { method: 'POST', body: withMessage, headers }), env, ctx());
    assert.equal(res.status, 401);
  }
});

const failedStatus = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'P1' }, statuses: [{ id: 'o1', status: 'failed' }, { id: 'o2', status: 'read' }] } }] }] });
const otherNumber = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'OTHER' }, messages: [{ id: 'm9', from: '57300', type: 'text', text: { body: 'hola' } }] } }] }] });

test('row 1: failed statuses are forwarded, read receipts are dropped, other numbers are ignored', async () => {
  const { relevantEvents } = await load();
  const f = relevantEvents(JSON.parse(failedStatus), 'P1');
  assert.deepEqual(f.entry[0].changes[0].value.statuses.map((s) => s.id), ['o1']);
  assert.equal(relevantEvents(JSON.parse(onlyStatus), ''), null);
  assert.equal(relevantEvents(JSON.parse(otherNumber), 'P1'), null);
});

test('row 5/9: without a queue the relay retries Apps Script three times', async () => {
  const { forwardWithRetry } = await load();
  const realFetch = global.fetch;
  let n = 0;
  global.fetch = async () => { n++; return n < 3 ? new Response('boom', { status: 500 }) : new Response('{"ok":true}'); };
  try {
    const ok = await forwardWithRetry(env, JSON.parse(withMessage), async () => {});
    assert.equal(ok, true);
    assert.equal(n, 3);
  } finally { global.fetch = realFetch; }
});

test('row 5: with a queue, events are enqueued before answering and retried by the consumer', async () => {
  const { default: worker } = await load();
  const sent = [];
  const qenv = Object.assign({}, env, { QUEUE: { send: async (b) => sent.push(b) } });
  const res = await worker.fetch(new Request('https://relay.test/', { method: 'POST', body: withMessage, headers: { 'X-Hub-Signature-256': signed(withMessage) } }), qenv, ctx());
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);

  const broken = Object.assign({}, env, { QUEUE: { send: async () => { throw new Error('down'); } } });
  const res2 = await worker.fetch(new Request('https://relay.test/', { method: 'POST', body: withMessage, headers: { 'X-Hub-Signature-256': signed(withMessage) } }), broken, ctx());
  assert.equal(res2.status, 500, 'Meta retries when the queue is down');

  const realFetch = global.fetch;
  global.fetch = async () => new Response('nope', { status: 503 });
  const acks = [], retries = [];
  try {
    await worker.queue({ messages: [{ body: JSON.parse(withMessage), attempts: 1, ack: () => acks.push(1), retry: (o) => retries.push(o) }] }, env);
  } finally { global.fetch = realFetch; }
  assert.equal(acks.length, 0);
  assert.equal(retries[0].delaySeconds, 30);
});

test('health endpoint reports config and Apps Script status', async () => {
  const { default: worker } = await load();
  const realFetch = global.fetch;
  global.fetch = async (u) => { assert.match(String(u), /action=salud/); return new Response('{"ok":true,"hoja":"ok"}'); };
  try {
    const res = await worker.fetch(new Request('https://relay.test/health'), env, ctx());
    assert.equal(res.status, 200);
    assert.equal((await res.json()).apps_script.hoja, 'ok');
  } finally { global.fetch = realFetch; }
});
