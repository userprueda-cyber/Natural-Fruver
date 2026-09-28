const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./gas-mock');

// Fixed prices, stock and an offer, so the tests don't depend on the seed prices in Setup.gs.
const FIXTURE = {
  'mango-tommy': { precio: 6000, precio_oferta: 5000, stock: 20 },
  'aguacate-papelillo': { precio: 2500, stock: 40 },
  'fresa': { stock: 10 },
  'banano': { precio: 3000, stock: '' },
  'huevos-aa-x-30': { precio: 18000 }
};

function setupEnv() {
  const env = createEnv();
  env.gs.setup();
  const t = env.gs.table_('Productos');
  Object.keys(FIXTURE).forEach((id) => {
    const row = t.rows.find((p) => p.id === id);
    Object.keys(FIXTURE[id]).forEach((col) => env.gs.setCell_(t, row, col, FIXTURE[id][col]));
  });
  env.gs.invalidateCatalog_();
  return env;
}

function post(env, body) {
  const out = env.gs.doPost({ postData: { contents: JSON.stringify(body) } });
  return JSON.parse(out.text);
}

function get(env, action) {
  return JSON.parse(env.gs.doGet({ parameter: { action } }).text);
}

function pin(env) {
  return env.gs.table_('Trabajadores').rows[0].pin;
}

function product(env, id) {
  return env.gs.table_('Productos').rows.find((p) => p.id === id);
}

const customer = { nombre: 'Ana', telefono: '3001234567', entrega: 'domicilio', direccion: 'Cra 7 # 20-30' };

test('setup creates tabs, sample data and an admin PIN; running it twice adds nothing', () => {
  const env = setupEnv();
  const count = env.gs.table_('Productos').rows.length;
  assert.ok(count >= 10);
  assert.match(String(pin(env)), /^\d{6}$/);
  env.gs.setup();
  assert.equal(env.gs.table_('Productos').rows.length, count);
  assert.equal(env.gs.table_('Trabajadores').rows.length, 1);
});

test('catalog hides private config, applies offers and marks tracked stock', () => {
  const env = setupEnv();
  const cat = get(env, 'catalogo');
  assert.equal(cat.ok, true);
  assert.equal(cat.config.correo_resumen, undefined);
  const mango = cat.productos.find((p) => p.id === 'mango-tommy');
  assert.equal(mango.oferta, 5000);
  assert.equal(mango.stock, 20);
  const banano = cat.productos.find((p) => p.id === 'banano');
  assert.equal(banano.stock, null);
  assert.equal(banano.disponible, true);
  assert.ok(cat.categorias.every((c) => cat.productos.some((p) => p.categoria === c.nombre)));
});

test('expired offers are ignored', () => {
  const env = setupEnv();
  const t = env.gs.table_('Productos');
  env.gs.setCell_(t, t.rows.find((p) => p.id === 'mango-tommy'), 'oferta_hasta', '2000-01-01');
  env.gs.invalidateCatalog_();
  const mango = get(env, 'catalogo').productos.find((p) => p.id === 'mango-tommy');
  assert.equal(mango.oferta, null);
});

test('an order decrements stock, uses server prices and gets a number', () => {
  const env = setupEnv();
  const res = post(env, {
    action: 'pedido',
    cliente: customer,
    items: [
      { id: 'mango-tommy', cantidad: 2.5 },
      { id: 'aguacate-papelillo', cantidad: 3, precio: 1 }, // client price is ignored
      { id: 'banano', cantidad: 1.2 } // rounded to 1 kg; stock not tracked
    ]
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.nro, 'NF-0001');
  assert.equal(product(env, 'mango-tommy').stock, 17.5);
  assert.equal(product(env, 'aguacate-papelillo').stock, 37);
  assert.equal(product(env, 'banano').stock, '');
  const expected = 2.5 * 5000 + 3 * 2500 + 1 * 3000;
  assert.equal(res.subtotal, expected);
  assert.equal(res.domicilio, 4000);
  assert.equal(res.total, expected + 4000);
  assert.equal(env.isLocked(), false);

  const second = post(env, { action: 'pedido', cliente: customer, items: [{ id: 'banano', cantidad: 1 }] });
  assert.equal(second.nro, 'NF-0002');
});

test('free delivery over the threshold and no fee for pickup', () => {
  const env = setupEnv();
  const big = post(env, { action: 'pedido', cliente: customer, items: [{ id: 'huevos-aa-x-30', cantidad: 4 }] });
  assert.equal(big.domicilio, 0);
  const pickup = post(env, {
    action: 'pedido', cliente: { nombre: 'Ana', telefono: '3001234567', entrega: 'recoger' },
    items: [{ id: 'banano', cantidad: 1 }]
  });
  assert.equal(pickup.ok, true);
  assert.equal(pickup.domicilio, 0);
});

test('the last unit can only be sold once', () => {
  const env = setupEnv();
  const t = env.gs.table_('Productos');
  env.gs.setCell_(t, t.rows.find((p) => p.id === 'fresa'), 'stock', 1);
  const first = post(env, { action: 'pedido', cliente: customer, items: [{ id: 'fresa', cantidad: 1 }] });
  const second = post(env, { action: 'pedido', cliente: customer, items: [{ id: 'fresa', cantidad: 1 }] });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.error, 'sin_stock');
  assert.equal(second.problemas[0].motivo, 'agotado');
  assert.equal(get(env, 'catalogo').productos.find((p) => p.id === 'fresa').disponible, false);
});

test('ordering more than available reports what is left and changes nothing', () => {
  const env = setupEnv();
  const res = post(env, {
    action: 'pedido', cliente: customer,
    items: [{ id: 'mango-tommy', cantidad: 1 }, { id: 'fresa', cantidad: 11 }]
  });
  assert.equal(res.ok, false);
  assert.deepEqual(res.problemas.map((p) => [p.id, p.disponible]), [['fresa', 10]]);
  assert.equal(product(env, 'mango-tommy').stock, 20);
  assert.equal(env.gs.table_('Pedidos').rows.length, 0);
});

test('customer data is validated and the honeypot blocks bots', () => {
  const env = setupEnv();
  const items = [{ id: 'banano', cantidad: 1 }];
  assert.equal(post(env, { action: 'pedido', cliente: { ...customer, nombre: '' }, items }).error, 'datos');
  assert.equal(post(env, { action: 'pedido', cliente: { ...customer, direccion: '' }, items }).error, 'datos');
  assert.equal(post(env, { action: 'pedido', cliente: customer, items: [] }).error, 'vacio');
  assert.equal(post(env, { action: 'pedido', cliente: customer, items, website: 'x' }).error, 'spam');
});

test('cancelling an order restocks; delivered orders are final', () => {
  const env = setupEnv();
  const p = pin(env);
  const order = post(env, { action: 'pedido', cliente: customer, items: [{ id: 'mango-tommy', cantidad: 4 }] });
  assert.equal(product(env, 'mango-tommy').stock, 16);

  const cancel = post(env, { action: 'admin_pedido', pin: p, nro: order.nro, estado: 'cancelado' });
  assert.equal(cancel.ok, true);
  assert.equal(product(env, 'mango-tommy').stock, 20);
  // Cancelling twice does not restock twice.
  post(env, { action: 'admin_pedido', pin: p, nro: order.nro, estado: 'cancelado' });
  assert.equal(product(env, 'mango-tommy').stock, 20);
  assert.equal(post(env, { action: 'admin_pedido', pin: p, nro: order.nro, estado: 'confirmado' }).error, 'final');

  const o2 = post(env, { action: 'pedido', cliente: customer, items: [{ id: 'mango-tommy', cantidad: 1 }] });
  assert.equal(post(env, { action: 'admin_pedido', pin: p, nro: o2.nro, estado: 'confirmado' }).ok, true);
  assert.equal(post(env, { action: 'admin_pedido', pin: p, nro: o2.nro, estado: 'entregado' }).ok, true);
  assert.equal(post(env, { action: 'admin_pedido', pin: p, nro: o2.nro, estado: 'cancelado' }).error, 'final');
  assert.equal(product(env, 'mango-tommy').stock, 19);
});

test('stale pending orders are auto-cancelled and restocked', () => {
  const env = setupEnv();
  const order = post(env, { action: 'pedido', cliente: customer, items: [{ id: 'aguacate-papelillo', cantidad: 5 }] });
  assert.equal(env.gs.cancelStalePendingOrders(), 0); // just created
  const t = env.gs.table_('Pedidos');
  env.gs.setCell_(t, t.rows[0], 'fecha', new Date(Date.now() - 4 * 3600 * 1000));
  assert.equal(env.gs.cancelStalePendingOrders(), 1);
  assert.equal(env.gs.table_('Pedidos').rows[0].estado, 'cancelado');
  assert.equal(env.gs.table_('Pedidos').rows[0].nro, order.nro);
  assert.equal(product(env, 'aguacate-papelillo').stock, 40);
});

test('admin actions require a valid PIN and lock out after repeated failures', () => {
  const env = setupEnv();
  assert.equal(post(env, { action: 'admin_datos', pin: '000000' }).error, 'pin');
  assert.equal(post(env, { action: 'admin_login', pin: pin(env) }).nombre, 'Administrador');
  for (let i = 0; i < 10; i++) post(env, { action: 'admin_login', pin: '999999' });
  assert.equal(post(env, { action: 'admin_login', pin: pin(env) }).error, 'bloqueado');
});

test('workers can add, edit, toggle, adjust stock and archive products', () => {
  const env = setupEnv();
  const p = pin(env);
  const created = post(env, {
    action: 'admin_guardar', pin: p,
    producto: { nombre: 'Piña Oro Miel', categoria: 'Frutas', precio: '4.500', unidad: 'unidad', stock: 12, foto_url: 'javascript:alert(1)' }
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.id, 'pina-oro-miel');
  const row = product(env, 'pina-oro-miel');
  assert.equal(row.precio, 4500);
  assert.equal(row.foto_url, '');
  assert.equal(row.actualizado_por, 'Administrador');

  const again = post(env, { action: 'admin_guardar', pin: p, producto: { nombre: 'Piña Oro Miel', precio: 5000 } });
  assert.equal(again.id, 'pina-oro-miel-2');

  assert.equal(post(env, { action: 'admin_guardar', pin: p, producto: { id: 'pina-oro-miel', precio_oferta: 6000 } }).error, 'datos');
  assert.equal(post(env, { action: 'admin_guardar', pin: p, producto: { id: 'pina-oro-miel', precio_oferta: 4000, oferta_hasta: '2099-12-31' } }).ok, true);
  let cat = get(env, 'catalogo');
  assert.equal(cat.productos.find((x) => x.id === 'pina-oro-miel').oferta, 4000);

  post(env, { action: 'admin_rapido', pin: p, id: 'pina-oro-miel', cambios: { disponible: false } });
  cat = get(env, 'catalogo');
  assert.equal(cat.productos.find((x) => x.id === 'pina-oro-miel').disponible, false);

  post(env, { action: 'admin_rapido', pin: p, id: 'pina-oro-miel', cambios: { disponible: true, stock: '' } });
  cat = get(env, 'catalogo');
  const pina = cat.productos.find((x) => x.id === 'pina-oro-miel');
  assert.equal(pina.disponible, true);
  assert.equal(pina.stock, null);

  post(env, { action: 'admin_archivar', pin: p, id: 'pina-oro-miel' });
  assert.equal(get(env, 'catalogo').productos.some((x) => x.id === 'pina-oro-miel'), false);
  const data = post(env, { action: 'admin_datos', pin: p });
  assert.equal(data.productos.find((x) => x.id === 'pina-oro-miel').archivado, true);
});

test('photo upload stores a public file and rejects non-images', () => {
  const env = setupEnv();
  const p = pin(env);
  const png = 'data:image/png;base64,' + Buffer.from('fake').toString('base64');
  const res = post(env, { action: 'admin_foto', pin: p, dataUrl: png, nombre: 'Mango' });
  assert.equal(res.ok, true);
  assert.match(res.url, /^https:\/\/drive\.google\.com\/thumbnail\?id=file1/);
  assert.equal(post(env, { action: 'admin_foto', pin: p, dataUrl: 'data:text/html;base64,PGI+' }).error, 'datos');
});

test('daily summary emails yesterday orders and low stock', () => {
  const env = setupEnv();
  const cfg = env.gs.table_('Config');
  env.gs.setCell_(cfg, cfg.rows.find((r) => r.clave === 'correo_resumen'), 'valor', 'dueno@example.com');
  post(env, { action: 'pedido', cliente: customer, items: [{ id: 'fresa', cantidad: 9 }] });
  const t = env.gs.table_('Pedidos');
  env.gs.setCell_(t, t.rows[0], 'fecha', new Date(Date.now() - 24 * 3600 * 1000));
  env.gs.sendDailySummary();
  assert.equal(env.sentMail.length, 1);
  assert.match(env.sentMail[0].body, /Pedidos: 1/);
  assert.match(env.sentMail[0].body, /Fresa: 1 kg/);
});

test('number parsing understands Colombian formats', () => {
  const { gs } = createEnv();
  assert.equal(gs.num_('4.500', 0), 4500);
  assert.equal(gs.num_('$ 12.000', 0), 12000);
  assert.equal(gs.num_('2,5', 0), 2.5);
  assert.equal(gs.num_('2.5', 0), 2.5);
  assert.equal(gs.num_('1.250,50', 0), 1250.5);
  assert.equal(gs.num_('', 7), 7);
});

test('seeded products point at photo files that exist in site/', () => {
  const fs = require('fs');
  const path = require('path');
  const env = setupEnv();
  const rows = env.gs.table_('Productos').rows;
  const withPhoto = rows.filter((p) => p.foto_url);
  assert.ok(withPhoto.length > 100);
  withPhoto.forEach((p) => {
    assert.equal(p.foto_url, 'img/productos/' + p.id + '.jpg');
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'site', p.foto_url)), 'falta ' + p.foto_url);
  });
});

test('saving a product keeps its bundled photo but rejects other relative paths', () => {
  const env = setupEnv();
  const p = pin(env);
  const keep = post(env, { action: 'admin_guardar', pin: p, producto: { id: 'banano', precio: 3200, foto_url: 'img/productos/banano.jpg' } });
  assert.equal(keep.ok, true, JSON.stringify(keep));
  assert.equal(product(env, 'banano').foto_url, 'img/productos/banano.jpg');
  post(env, { action: 'admin_guardar', pin: p, producto: { id: 'banano', foto_url: '../admin.html' } });
  assert.equal(product(env, 'banano').foto_url, '');
});

test('addCatalogPhotos fills only missing photos', () => {
  const env = setupEnv();
  const t = env.gs.table_('Productos');
  env.gs.setCell_(t, t.rows.find((p) => p.id === 'banano'), 'foto_url', '');
  env.gs.setCell_(t, t.rows.find((p) => p.id === 'fresa'), 'foto_url', 'https://drive.google.com/x');
  const log = console.log;
  console.log = () => {};
  const count = env.gs.addCatalogPhotos();
  console.log = log;
  assert.equal(count, 1);
  assert.equal(product(env, 'banano').foto_url, 'img/productos/banano.jpg');
  assert.equal(product(env, 'fresa').foto_url, 'https://drive.google.com/x');
});
