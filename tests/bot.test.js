const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./gas-mock');

const CUSTOMER = '573001112233';
const WORKER = '573004445566';

function setupBot() {
  const env = createEnv();
  const log = console.log;
  console.log = () => {};
  env.gs.setup();
  console.log = log;
  const t = env.gs.table_('Productos');
  const fixture = {
    'mango-tommy': { precio: 6000, precio_oferta: 5000, stock: 20 },
    'fresa': { stock: 10 },
    'banano': { precio: 3000, stock: '' }
  };
  Object.keys(fixture).forEach((id) => {
    const row = t.rows.find((p) => p.id === id);
    Object.keys(fixture[id]).forEach((col) => env.gs.setCell_(t, row, col, fixture[id][col]));
  });
  const w = env.gs.table_('Trabajadores');
  env.gs.setCell_(w, w.rows[0], 'whatsapp', '300 444 5566');
  env.props.set('WA_TOKEN', 'token');
  env.props.set('WA_PHONE_ID', 'PHONE');
  env.props.set('WA_CATALOG_ID', 'CAT');
  return env;
}

let msgSeq = 0;
function message(from, msg) {
  return Object.assign({ from, id: 'wamid.in' + (++msgSeq), timestamp: '1' }, msg);
}
const text = (body) => ({ type: 'text', text: { body } });
const reply = (id) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: id } } });
const cart = (items) => ({
  type: 'order',
  order: { catalog_id: 'CAT', product_items: items.map(([id, q]) => ({ product_retailer_id: id, quantity: q, item_price: 1, currency: 'COP' })) }
});

/** Envía un mensaje al bot y devuelve los mensajes que respondió (solo los de /messages). */
function send(env, from, msg, name) {
  const before = env.fetches.length;
  const m = msg.id ? msg : message(from, msg);
  const res = env.gs.handlePost_({
    action: 'wa_webhook',
    secret: env.props.get('RELAY_SECRET'),
    payload: {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: {
        contacts: [{ wa_id: from, profile: { name: name || 'Ana María' } }],
        messages: [m]
      } }] }]
    }
  });
  assert.equal(res.ok, true);
  return env.fetches.slice(before).filter((f) => /\/messages$/.test(f.url) && f.payload.type).map((f) => f.payload);
}

const bodyOf = (m) => (m.type === 'text' ? m.text.body : m.interactive.body.text);
const buttonIds = (m) => m.interactive.action.buttons.map((b) => b.reply.id);

test('the relay secret is required', () => {
  const env = setupBot();
  assert.throws(() => env.gs.handlePost_({ action: 'wa_webhook', secret: 'nope', payload: {} }), /No autorizado/);
  env.props.delete('RELAY_SECRET');
  assert.throws(() => env.gs.handlePost_({ action: 'wa_webhook', secret: '', payload: {} }), /No autorizado/);
});

test('a greeting shows the menu with the store state; repeated message ids are ignored', () => {
  const env = setupBot();
  const m = message(CUSTOMER, text('Hola!'));
  const out = send(env, CUSTOMER, m);
  assert.equal(out.length, 1);
  assert.match(bodyOf(out[0]), /Hola Ana/);
  assert.match(bodyOf(out[0]), /(Abierto|Cerrado)/);
  assert.deepEqual(buttonIds(out[0]), ['cat', 'mis', 'info']);
  assert.equal(send(env, CUSTOMER, m).length, 0);
});

test('categories list and product lists from the Meta catalog, 30 per message', () => {
  const env = setupBot();
  const [list] = send(env, CUSTOMER, reply('cat'));
  const rows = list.interactive.action.sections[0].rows;
  assert.ok(rows.some((r) => r.id === 'cat:Frutas'));
  assert.ok(rows.some((r) => r.id === 'cat:*ofertas'));
  assert.equal(rows[rows.length - 1].id, 'todo');
  assert.ok(rows.length <= 10);

  const veg = send(env, CUSTOMER, { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'cat:Verduras', title: 'Verduras' } } });
  assert.equal(veg.length, 2); // 31 verduras → 30 + 1
  assert.equal(veg[0].interactive.type, 'product_list');
  assert.equal(veg[0].interactive.action.catalog_id, 'CAT');
  assert.equal(veg[0].interactive.action.sections[0].product_items.length, 30);

  const drinks = send(env, CUSTOMER, reply('cat:Bebidas y más'));
  const ids = drinks[0].interactive.action.sections[0].product_items.map((p) => p.product_retailer_id);
  assert.ok(ids.includes('helados-caseros'));
  assert.ok(!ids.some((id) => id.startsWith('cerveza')), 'beer is not in the WhatsApp catalog');
});

test('typing a product name searches the catalog', () => {
  const env = setupBot();
  const [res] = send(env, CUSTOMER, text('mangos'));
  assert.equal(res.interactive.type, 'product_list');
  assert.deepEqual(res.interactive.action.sections[0].product_items.map((p) => p.product_retailer_id), ['mango-tommy']);
  const [none] = send(env, CUSTOMER, text('pizza'));
  assert.match(bodyOf(none), /No encontré "pizza"/);
});

test('full order: cart → delivery → address → name → confirm, stock and workers updated', () => {
  const env = setupBot();
  let out = send(env, CUSTOMER, cart([['mango-tommy', 2], ['banano', 1]]));
  assert.match(bodyOf(out[0]), /2 kg Mango Tommy — \$10\.000/);
  assert.match(bodyOf(out[0]), /Subtotal: \*\$13\.000\*/);
  assert.deepEqual(buttonIds(out[0]), ['ent:domicilio', 'ent:recoger', 'cancelar']);

  out = send(env, CUSTOMER, reply('ent:domicilio'));
  assert.match(bodyOf(out[0]), /dirección/);
  out = send(env, CUSTOMER, text('Cerritos, Cra 7 # 20-30, casa verde'));
  assert.match(bodyOf(out[0]), /A nombre de quién.*Ana María/);
  out = send(env, CUSTOMER, text('Ana Gómez'));
  const summary = bodyOf(out[0]);
  assert.match(summary, /Domicilio: \$4\.000/);
  assert.match(summary, /Total: \$17\.000/);
  assert.match(summary, /Cra 7 # 20-30/);
  assert.deepEqual(buttonIds(out[0]), ['ok', 'nota', 'cancelar']);

  out = send(env, CUSTOMER, text('mangos bien maduros'));
  assert.match(bodyOf(out[0]), /Nota: mangos bien maduros/);

  out = send(env, CUSTOMER, reply('ok'));
  const toCustomer = out.filter((m) => m.to === CUSTOMER);
  const toWorker = out.filter((m) => m.to === WORKER);
  assert.match(bodyOf(toCustomer[0]), /Pedido NF-0001 recibido/);
  assert.match(bodyOf(toWorker[0]), /Nuevo pedido NF-0001[\s\S]*Ana Gómez[\s\S]*Cra 7[\s\S]*maduros/);
  assert.deepEqual(buttonIds(toWorker[0]), ['st:NF-0001:confirmado', 'st:NF-0001:cancelado']);

  const order = env.gs.table_('Pedidos').rows[0];
  assert.equal(order.total, 17000);
  assert.equal(order.actualizado_por, 'whatsapp');
  assert.equal(order.telefono, CUSTOMER);
  assert.equal(env.gs.table_('Productos').rows.find((p) => p.id === 'mango-tommy').stock, 18);
  const client = env.gs.table_('Clientes').rows[0];
  assert.equal(client.nombre, 'Ana Gómez');
  assert.equal(client.paso, '');

  // El siguiente pedido reutiliza la dirección guardada.
  send(env, CUSTOMER, cart([['fresa', 1]]));
  out = send(env, CUSTOMER, reply('ent:domicilio'));
  assert.deepEqual(buttonIds(out[0]), ['dir:misma', 'dir:otra']);
  out = send(env, CUSTOMER, reply('dir:misma'));
  assert.deepEqual(buttonIds(out[0]), ['ok', 'nota', 'cancelar']);
});

test('pickup skips the address and cancelling clears the cart', () => {
  const env = setupBot();
  send(env, CUSTOMER, cart([['fresa', 2]]));
  let out = send(env, CUSTOMER, reply('ent:recoger'));
  assert.match(bodyOf(out[0]), /A nombre de quién/);
  out = send(env, CUSTOMER, text('Ana'));
  assert.match(bodyOf(out[0]), /Recoges en la tienda/);
  assert.doesNotMatch(bodyOf(out[0]), /Domicilio:/);
  out = send(env, CUSTOMER, reply('cancelar'));
  assert.match(bodyOf(out[0]), /cancelé/);
  assert.equal(env.gs.table_('Pedidos').rows.length, 0);
  assert.equal(send(env, CUSTOMER, reply('ok'))[0].interactive.action.buttons[0].reply.id, 'cat'); // vuelve al menú
});

test('a product that sells out before confirming is removed and explained', () => {
  const env = setupBot();
  send(env, CUSTOMER, cart([['fresa', 1], ['banano', 1]]));
  send(env, CUSTOMER, reply('ent:recoger'));
  send(env, CUSTOMER, text('Ana'));
  const t = env.gs.table_('Productos');
  env.gs.setCell_(t, t.rows.find((p) => p.id === 'fresa'), 'stock', 0);
  const out = send(env, CUSTOMER, reply('ok'));
  assert.match(bodyOf(out[0]), /se agotó:\n• Fresa/);
  assert.match(bodyOf(out[1]), /Revisa tu pedido/);
  assert.doesNotMatch(bodyOf(out[1]), /Fresa/);
  assert.equal(env.gs.table_('Pedidos').rows.length, 0);
});

test('workers confirm orders with a button and the customer is told', () => {
  const env = setupBot();
  send(env, CUSTOMER, cart([['banano', 2]]));
  send(env, CUSTOMER, reply('ent:recoger'));
  send(env, CUSTOMER, text('Ana'));
  send(env, CUSTOMER, reply('ok'));

  let out = send(env, WORKER, reply('st:NF-0001:confirmado'));
  assert.match(bodyOf(out.find((m) => m.to === CUSTOMER)), /NF-0001\* fue confirmado.*tienda/);
  assert.match(bodyOf(out.find((m) => m.to === WORKER)), /NF-0001 confirmado/);
  assert.equal(env.gs.table_('Pedidos').rows[0].estado, 'confirmado');
  assert.equal(env.gs.table_('Pedidos').rows[0].actualizado_por, 'Administrador');

  out = send(env, WORKER, text('pedidos'));
  assert.match(bodyOf(out[0]), /NF-0001\* · Ana/);
  out = send(env, WORKER, text('entregado 1'));
  assert.equal(env.gs.table_('Pedidos').rows[0].estado, 'entregado');
  out = send(env, WORKER, text('cancelar 1'));
  assert.match(bodyOf(out[0]), /ya está entregado/);
});

test('worker commands change prices, offers, stock and availability, and sync Meta', () => {
  const env = setupBot();
  const product = (id) => env.gs.table_('Productos').rows.find((p) => p.id === id);

  let before = env.fetches.length;
  let out = send(env, WORKER, text('precio mango 5.500'));
  assert.match(bodyOf(out[0]), /Precio de Mango Tommy: \$5\.500/);
  assert.equal(product('mango-tommy').precio, 5500);
  assert.equal(product('mango-tommy').actualizado_por, 'Administrador');
  const batch = env.fetches.slice(before).find((f) => /CAT\/items_batch$/.test(f.url));
  assert.equal(batch.payload.requests[0].data.id, 'mango-tommy');
  assert.equal(batch.payload.requests[0].data.price, '5500.00 COP');

  out = send(env, WORKER, text('oferta mango 6000'));
  assert.match(bodyOf(out[0]), /menor que el precio normal/);
  send(env, WORKER, text('oferta mango 4500 hasta 15/10'));
  assert.equal(product('mango-tommy').precio_oferta, 4500);
  assert.match(product('mango-tommy').oferta_hasta, /-10-15$/);
  send(env, WORKER, text('oferta mango quitar'));
  assert.equal(product('mango-tommy').precio_oferta, '');

  send(env, WORKER, text('stock mango +5'));
  assert.equal(product('mango-tommy').stock, 25);
  out = send(env, WORKER, text('stock mango no'));
  assert.match(bodyOf(out[0]), /Ya no se cuenta/);
  assert.equal(product('mango-tommy').stock, '');

  before = env.fetches.length;
  send(env, WORKER, text('agotado fresas'));
  assert.equal(product('fresa').disponible, 'no');
  const off = env.fetches.slice(before).find((f) => /items_batch$/.test(f.url));
  assert.equal(off.payload.requests[0].data.availability, 'out of stock');
  send(env, WORKER, text('disponible fresa'));
  assert.equal(product('fresa').disponible, 'si');

  out = send(env, WORKER, text('precio queso 100'));
  assert.match(bodyOf(out[0]), /Hay varios productos[\s\S]*Queso campesino 500 g/);
  out = send(env, WORKER, text('ver aguacate'));
  assert.match(bodyOf(out[0]), /Aguacate papelillo[\s\S]*disponible/);
  out = send(env, WORKER, text('qué más?'));
  assert.match(bodyOf(out[0]), /No entendí[\s\S]*Comandos/);
});

test('a worker can also order as a customer', () => {
  const env = setupBot();
  let out = send(env, WORKER, text('comprar'));
  assert.equal(out[0].interactive.type, 'list');
  send(env, WORKER, cart([['banano', 1]]));
  send(env, WORKER, reply('ent:recoger'));
  out = send(env, WORKER, text('Pedro')); // su nombre, no un comando
  assert.match(bodyOf(out[0]), /Revisa tu pedido/);
});

test('workers outside the 24-hour window get the approved template', () => {
  const env = setupBot();
  const cfg = env.gs.table_('Config');
  env.gs.setCell_(cfg, cfg.rows.find((r) => r.clave === 'plantilla_aviso_pedido'), 'valor', 'aviso_pedido');
  env.net.reply = (url, payload) => (payload && payload.to === WORKER && payload.type === 'interactive'
    ? { status: 400, body: { error: { code: 131047, message: 'Re-engagement message' } } }
    : null);
  send(env, CUSTOMER, cart([['banano', 1]]));
  send(env, CUSTOMER, reply('ent:recoger'));
  send(env, CUSTOMER, text('Ana'));
  const out = send(env, CUSTOMER, reply('ok'));
  const tpl = out.find((m) => m.to === WORKER && m.type === 'template');
  assert.equal(tpl.template.name, 'aviso_pedido');
  assert.deepEqual(tpl.template.components[0].parameters.map((p) => p.text), ['NF-0001', 'Ana', '$3.000']);
});

test('catalog items for Meta: photos, prices, offers; beer and archived items are removed', () => {
  const env = setupBot();
  const t = env.gs.table_('Productos');
  env.gs.setCell_(t, t.rows.find((p) => p.id === 'kiwi'), 'archivado', 'si');
  const res = env.gs.syncCatalog_();
  assert.equal(res.ok, true);
  const requests = env.fetches.filter((f) => /items_batch$/.test(f.url)).flatMap((f) => f.payload.requests);
  assert.equal(requests.length, t.rows.length);
  const byId = Object.fromEntries(requests.map((r) => [r.data.id, r]));
  const mango = byId['mango-tommy'];
  assert.equal(mango.method, 'UPDATE');
  assert.equal(mango.data.title, 'Mango Tommy (kg)');
  assert.equal(mango.data.price, '6000.00 COP');
  assert.equal(mango.data.sale_price, '5000.00 COP');
  assert.equal(mango.data.image_link, 'https://userprueda-cyber.github.io/Natural-Fruver/img/productos/mango-tommy.jpg');
  assert.equal(mango.data.link, 'https://wa.me/573135962382');
  assert.equal(byId.lulo.data.image_link, 'https://userprueda-cyber.github.io/Natural-Fruver/img/sin-foto.jpg');
  assert.equal(byId['cerveza-club-colombia'].method, 'DELETE');
  assert.equal(byId.kiwi.method, 'DELETE');
});

test('store hours: open now, closing time and next opening', () => {
  const env = setupBot();
  const h = 'lun-vie 08:30-18:00; sab-dom 08:30-16:00';
  const at = (iso) => new Date(iso);
  const state = (d) => JSON.parse(JSON.stringify(env.gs.openState_(h, d)));
  assert.deepEqual(state(at('2026-09-28T15:00:00Z')), { open: true, text: 'Abierto · cierra 6:00 p. m.' }); // lunes 10:00
  assert.deepEqual(state(at('2026-09-27T22:00:00Z')), { open: false, text: 'Cerrado · abre mañana 8:30 a. m.' }); // domingo 17:00
  assert.deepEqual(state(at('2026-10-03T12:00:00Z')), { open: false, text: 'Cerrado · abre hoy 8:30 a. m.' }); // sábado 7:00
  assert.match(env.gs.hoursText_(h), /^Lunes: 8:30 a\. m\. – 6:00 p\. m\.[\s\S]*Domingo: 8:30 a\. m\. – 4:00 p\. m\.$/);
});
