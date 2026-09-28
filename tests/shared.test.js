const test = require('node:test');
const assert = require('node:assert/strict');
const NF = require('../site/js/shared.js');

const products = [
  { id: 'platano', nombre: 'Plátano hartón', categoria: 'Tubérculos', palabras: 'platano verde maduro', disponible: true },
  { id: 'aguacate', nombre: 'Aguacate Hass', categoria: 'Frutas', palabras: 'palta', disponible: true },
  { id: 'mango', nombre: 'Mango Tommy', categoria: 'Frutas', palabras: '', disponible: true },
  { id: 'maracuya', nombre: 'Maracuyá', categoria: 'Frutas', palabras: 'parchita', disponible: false },
  { id: 'cebolla', nombre: 'Cebolla cabezona', categoria: 'Verduras', palabras: '', disponible: true },
  { id: 'cebolla-larga', nombre: 'Cebolla larga', categoria: 'Hierbas', palabras: 'cebollin junca', disponible: true }
];
const ids = (list) => list.map((p) => p.id);

test('search ignores accents and case', () => {
  assert.deepEqual(ids(NF.search(products, 'platano')), ['platano']);
  assert.deepEqual(ids(NF.search(products, 'MARACUYA')), ['maracuya']);
});

test('search uses keywords and tolerates one typo', () => {
  assert.deepEqual(ids(NF.search(products, 'palta')), ['aguacate']);
  assert.deepEqual(ids(NF.search(products, 'aguacte')), ['aguacate']);
  assert.deepEqual(ids(NF.search(products, 'mnago')), ['mango']);
});

test('search matches prefixes and needs every word', () => {
  assert.deepEqual(ids(NF.search(products, 'ceb')), ['cebolla', 'cebolla-larga']);
  assert.deepEqual(ids(NF.search(products, 'cebolla larga')), ['cebolla-larga']);
  assert.deepEqual(ids(NF.search(products, 'frutas')), ['aguacate', 'mango', 'maracuya']);
  assert.equal(NF.search(products, '').length, products.length);
  assert.equal(NF.search(products, 'computador').length, 0);
});

test('parseHours understands ranges of days and several time ranges', () => {
  const h = NF.parseHours('Lun-Sáb 07:00-19:00; dom 8:00 - 13:00');
  assert.deepEqual(h[1], [[420, 1140]]);
  assert.deepEqual(h[6], [[420, 1140]]);
  assert.deepEqual(h[0], [[480, 780]]);
  const h2 = NF.parseHours('lun, mie y vie 7-12 14-18');
  assert.deepEqual(Object.keys(h2).sort(), ['1', '3', '5']);
  assert.deepEqual(h2[3], [[420, 720], [840, 1080]]);
});

test('openState reports open/closed in Bogotá time', () => {
  const hours = 'lun-sab 07:00-19:00; dom 08:00-13:00';
  // 2026-09-28 is a Monday. Bogotá is UTC-5.
  assert.deepEqual(NF.openState(hours, new Date('2026-09-28T15:00:00Z')), { open: true, text: 'Abierto · cierra 7:00 p. m.' });
  assert.equal(NF.openState(hours, new Date('2026-09-28T11:00:00Z')).text, 'Cerrado · abre hoy 7:00 a. m.');
  assert.equal(NF.openState(hours, new Date('2026-09-29T01:00:00Z')).text, 'Cerrado · abre mañana 7:00 a. m.');
  // Saturday night → opens Sunday 8.
  assert.equal(NF.openState(hours, new Date('2026-10-04T01:00:00Z')).text, 'Cerrado · abre mañana 8:00 a. m.');
  assert.equal(NF.openState('', new Date()), null);
});

test('money and quantities use Colombian formatting', () => {
  assert.equal(NF.money(12500), '$ 12.500');
  assert.equal(NF.qty(2.5), '2,5');
  assert.equal(NF.step('kg'), 0.5);
  assert.equal(NF.step('unidad'), 1);
  assert.equal(NF.discountPct({ precio: 6000, oferta: 5000 }), 17);
});

test('the WhatsApp message lists the order and customer details', () => {
  const order = {
    nro: 'NF-0007', subtotal: 20000, domicilio: 0, total: 20000,
    lineas: [{ nombre: 'Mango Tommy', unidad: 'kg', cantidad: 2.5, total: 12500 }, { nombre: 'Aguacate Hass', unidad: 'unidad', cantidad: 3, total: 7500 }]
  };
  const msg = NF.orderMessage(order, { nombre: 'Ana', telefono: '300', entrega: 'domicilio', direccion: 'Cra 7' }, 'Natural Fruver');
  assert.match(msg, /^\*Pedido NF-0007\*/);
  assert.match(msg, /• 2,5 kg Mango Tommy — \$ 12\.500/);
  assert.match(msg, /• 3 und Aguacate Hass/);
  assert.match(msg, /Domicilio: gratis/);
  assert.match(msg, /Entrega: domicilio — Cra 7/);
  const link = NF.waLink('+57 300 123 4567', msg);
  assert.ok(link.startsWith('https://wa.me/573001234567?text=*Pedido%20NF-0007'));
});

test('placeholder tile uses the initial and a hue per category family', () => {
  assert.deepEqual(NF.placeholderTile({ nombre: 'mango Tommy', categoria: 'Frutas' }), { initial: 'M', hue: 28 });
  assert.equal(NF.placeholderTile({ nombre: 'Ñame', categoria: 'Tubérculos' }).initial, 'Ñ');
  assert.equal(NF.placeholderTile({ nombre: 'Lechuga', categoria: 'Verduras' }).hue, 128);
  const other = NF.placeholderTile({ nombre: 'Panela', categoria: 'Despensa' });
  assert.equal(other.hue, NF.placeholderTile({ nombre: 'Arroz', categoria: 'Despensa' }).hue);
});

test('icons reference the sprite and are hidden from screen readers', () => {
  const svg = NF.icon('map-pin');
  assert.match(svg, /href="img\/icons\.svg#i-map-pin"/);
  assert.match(svg, /aria-hidden="true"/);
});

test('mid-word matches only show when nothing matches a whole word or prefix', () => {
  const list = [
    { id: 'pina', nombre: 'Piña', categoria: 'Frutas', palabras: '', disponible: true },
    { id: 'leche', nombre: 'Leche Alpina entera', categoria: 'Lácteos', palabras: '', disponible: true },
    { id: 'espinaca', nombre: 'Espinaca', categoria: 'Verduras', palabras: '', disponible: true }
  ];
  assert.deepEqual(ids(NF.search(list, 'piña')), ['pina']);
  assert.deepEqual(ids(NF.search(list, 'alpina')), ['leche']);
  assert.deepEqual(ids(NF.search(list, 'spinac')), ['espinaca']); // only a mid-word match exists
});
