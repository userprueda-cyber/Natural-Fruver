// Utilidades compartidas por las pruebas de conversación (matrix, nlu, hardening).
const assert = require('node:assert/strict');
const { createEnv } = require('./gas-mock');

const CUSTOMER = '573001112233';
const WORKER = '573004445566';

function setConfig(env, key, value) {
  const t = env.gs.table_('Config');
  const row = t.rows.find((r) => String(r.clave).trim() === key);
  if (row) env.gs.setCell_(t, row, 'valor', value);
  else env.gs.writeRow_(t, { clave: key, valor: value, nota: '' });
}

function setupBot(opts = {}) {
  const env = createEnv();
  const log = console.log;
  console.log = () => {};
  env.gs.setup();
  console.log = log;
  const t = env.gs.table_('Productos');
  const fixture = Object.assign({
    'mango-tommy': { precio: 6000, precio_oferta: 5000, stock: 20 },
    fresa: { stock: 10 },
    banano: { precio: 3000, stock: '' }
  }, opts.products || {});
  Object.keys(fixture).forEach((id) => {
    const row = t.rows.find((p) => p.id === id);
    Object.keys(fixture[id]).forEach((col) => env.gs.setCell_(t, row, col, fixture[id][col]));
  });
  const w = env.gs.table_('Trabajadores');
  env.gs.setCell_(w, w.rows[0], 'whatsapp', '300 444 5566');
  env.props.set('WA_TOKEN', 'token');
  env.props.set('WA_PHONE_ID', 'PHONE');
  env.props.set('WA_CATALOG_ID', 'CAT');
  setConfig(env, 'espera_rafaga_seg', 0);
  setConfig(env, 'mensajes_por_minuto', 0);
  setConfig(env, 'horario', 'lun-dom 00:00-23:59');
  Object.entries(opts.config || {}).forEach(([k, v]) => setConfig(env, k, v));
  // Mensajes de estado del bot hacia los trabajadores quedan registrados como cualquier envío.
  return env;
}

let seq = 0;
const now = () => String(Math.floor(Date.now() / 1000));
function message(from, msg) {
  return Object.assign({ from, id: 'wamid.t' + (++seq), timestamp: now() }, msg);
}
const text = (body) => ({ type: 'text', text: { body } });
const reply = (id) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: id } } });
const cart = (items) => ({
  type: 'order',
  order: { catalog_id: 'CAT', product_items: items.map(([id, q]) => ({ product_retailer_id: id, quantity: q, item_price: 1, currency: 'COP' })) }
});

function webhook(env, value, secret) {
  return env.gs.handlePost_({
    action: 'wa_webhook',
    secret: secret === undefined ? env.props.get('RELAY_SECRET') : secret,
    payload: { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value }] }] }
  });
}

/** Envía un mensaje al bot y devuelve lo que respondió (solo /messages). */
function send(env, from, msg, name) {
  const before = env.fetches.length;
  const m = msg.id ? msg : message(from, msg);
  const res = webhook(env, { contacts: [{ wa_id: from, profile: { name: name || 'Ana María' } }], messages: [m] });
  assert.equal(res.ok, true);
  return env.fetches.slice(before).filter((f) => /\/messages$/.test(f.url) && f.payload && f.payload.type).map((f) => f.payload);
}

const bodyOf = (m) => (!m ? '' : m.type === 'text' ? m.text.body : m.type === 'template' ? '[tpl ' + m.template.name + ']' : m.interactive.body.text);
const buttonIds = (m) => (m && m.interactive && m.interactive.action.buttons ? m.interactive.action.buttons.map((b) => b.reply.id) : []);
const rowIds = (m) => (m && m.interactive && m.interactive.action.sections ? m.interactive.action.sections[0].rows.map((r) => r.id) : []);
const toCustomer = (out, who = CUSTOMER) => out.filter((m) => m.to === who);
const toWorker = (out) => out.filter((m) => m.to === WORKER);
const allText = (out) => out.map(bodyOf).join('\n---\n');

const orders = (env) => env.gs.table_('Pedidos').rows.filter((r) => r.nro);
const client = (env, phone = CUSTOMER) => env.gs.table_('Clientes').rows.find((r) => env.gs.samePhone_(r.telefono, phone));
const cartOf = (env, phone = CUSTOMER) => JSON.parse(client(env, phone).datos || '{}').carrito || [];

/** Pedido escrito completo hasta el resumen (recoger en tienda). */
function orderToSummary(env, from = CUSTOMER, what = '2 kilos de mango') {
  send(env, from, text(what));
  send(env, from, reply('fin'));
  send(env, from, reply('ent:recoger'));
  return send(env, from, text('Ana Gómez'));
}

module.exports = {
  CUSTOMER, WORKER, setupBot, setConfig, message, text, reply, cart, webhook, send,
  bodyOf, buttonIds, rowIds, toCustomer, toWorker, allText, orders, client, cartOf, orderToSummary
};
