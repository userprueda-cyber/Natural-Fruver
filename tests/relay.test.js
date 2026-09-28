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
