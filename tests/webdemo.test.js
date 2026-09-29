// La demo web corre el código real del bot dentro del navegador (site/demo.html).
// Aquí se prueba el mismo motor en Node, y que el paquete generado no esté desactualizado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { build, OUT } = require('../scripts/build-web-demo');
const { createEnv } = require('../site/js/demo-env');
const sources = require('../site/js/demo-gs');

const CUSTOMER = '573001112233';
const WORKER = '573004445566';

function boot() {
  const env = createEnv(sources);
  const log = console.log;
  console.log = () => {};
  env.gs.setup();
  console.log = log;
  const w = env.gs.table_('Trabajadores');
  env.gs.setCell_(w, w.rows[0], 'whatsapp', WORKER);
  ['WA_TOKEN', 'WA_PHONE_ID', 'WA_CATALOG_ID'].forEach((k) => env.props.set(k, 'demo'));
  const set = (k, v) => {
    const t = env.gs.table_('Config');
    const row = t.rows.find((r) => String(r.clave).trim() === k);
    if (row) env.gs.setCell_(t, row, 'valor', v); else env.gs.writeRow_(t, { clave: k, valor: v, nota: '' });
  };
  set('horario', 'lun-dom 00:00-23:59');
  set('espera_rafaga_seg', 0);
  set('ia_activa', 'no');
  return env;
}

let n = 0;
function send(env, from, msg) {
  const before = env.fetches.length;
  env.gs.handlePost_({
    action: 'wa_webhook', secret: env.props.get('RELAY_SECRET'),
    payload: { entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: from, profile: { name: 'Ana' } }], messages: [Object.assign({ from, id: 'wamid.demo' + (++n), timestamp: String(Math.floor(Date.now() / 1000)) }, msg)] } }] }] }
  });
  return env.fetches.slice(before).filter((f) => /\/messages$/.test(f.url) && f.payload && f.payload.type).map((f) => f.payload);
}
const text = (body) => ({ type: 'text', text: { body } });
const reply = (id) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: id } } });
const bodyOf = (m) => (m.type === 'text' ? m.text.body : m.interactive.body.text);

test('the packaged bot is up to date with apps-script/*.gs (run `npm run web-demo`)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), build());
});

test('web demo engine: a typed order goes from the customer phone to the worker phone', () => {
  const env = boot();
  let out = send(env, CUSTOMER, text('hola'));
  assert.match(bodyOf(out[0]), /asistente automático/);
  out = send(env, CUSTOMER, text('buenas me regala 2 lbs d tomate chonto y 3 aguacatess xfa'));
  assert.match(bodyOf(out[0]), /1 kg Tomate chonto[\s\S]*3 und Aguacate papelillo/);
  send(env, CUSTOMER, reply('fin'));
  send(env, CUSTOMER, reply('ent:recoger'));
  send(env, CUSTOMER, text('Ana Gómez'));
  out = send(env, CUSTOMER, reply('ok'));
  assert.ok(out.some((m) => m.to === CUSTOMER && /Pedido NF-0001 recibido/.test(bodyOf(m))));
  const alert = out.find((m) => m.to === WORKER);
  assert.match(bodyOf(alert), /Nuevo pedido NF-0001/);
  out = send(env, WORKER, reply('st:NF-0001:confirmado'));
  assert.ok(out.some((m) => m.to === CUSTOMER && /confirmado/.test(bodyOf(m))));
  assert.equal(env.gs.table_('Pedidos').rows[0].estado, 'confirmado');
});

test('the demo environment enforces Apps Script cache limits', () => {
  const env = boot();
  const cache = env.gs.CacheService ? null : null; // las funciones del bot usan cachePut_, que recorta a 6 h
  assert.equal(cache, null);
  assert.doesNotThrow(() => env.gs.cachePut_('k', 'v', 86400));
  assert.throws(() => env.cache.put('k', 'v', 86400), /6 h/);
  assert.throws(() => env.cache.put('k'.repeat(251), 'v', 10), /250/);
});
