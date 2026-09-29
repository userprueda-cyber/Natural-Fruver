// Corre scripts/telegram.js contra un Telegram falso y recorre un pedido completo.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const tg = require('../scripts/telegram-adapter');

test('adapter: WhatsApp formatting and buttons become Telegram HTML and inline keyboards', () => {
  assert.equal(tg.toHtml('*Total: $5.000* <b> _nota_'), '<b>Total: $5.000</b> &lt;b&gt; <i>nota</i>');
  const [call] = tg.toTelegramCalls({
    type: 'interactive',
    interactive: { type: 'button', body: { text: 'Hola' }, action: { buttons: [{ type: 'reply', reply: { id: 'cat', title: '🛒 Pedir' } }] } }
  }, 42, () => null);
  assert.equal(call.method, 'sendMessage');
  assert.deepEqual(call.body.reply_markup.inline_keyboard, [[{ text: '🛒 Pedir', callback_data: 'cat' }]]);
  assert.equal(tg.chatOf('571234567890', new Map([['1234567890', 7]])), 7);
  const order = tg.cartToOrder(9, { banano: 2, fresa: 0 });
  assert.deepEqual(order.order.product_items.map((p) => [p.product_retailer_id, p.quantity]), [['banano', 2]]);
});

function fakeTelegram() {
  const queue = [];
  const calls = [];
  let nextUpdate = 1;
  let msgId = 100;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const method = req.url.split('/').pop();
      const params = body ? JSON.parse(body) : {};
      const reply = (result) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, result })); };
      if (method === 'getMe') return reply({ username: 'prueba_bot' });
      if (method === 'getUpdates') {
        const send = () => reply(queue.splice(0).filter((u) => u.update_id >= (params.offset || 0)));
        return queue.length ? send() : setTimeout(send, 50);
      }
      calls.push({ method, params });
      reply({ message_id: ++msgId });
    });
  });
  const chat = { id: 5550001, type: 'private' };
  const from = { id: 5550001, first_name: 'Ana', last_name: 'Prueba' };
  return {
    server, calls,
    text(t) { queue.push({ update_id: nextUpdate++, message: { message_id: ++msgId, chat, from, text: t } }); },
    tap(data) { queue.push({ update_id: nextUpdate++, callback_query: { id: 'cb' + nextUpdate, from, data, message: { message_id: 555, chat } } }); }
  };
}

async function until(fn, what) {
  for (let i = 0; i < 100; i++) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('Timeout esperando: ' + what);
}

test('telegram runner: menu → catalog → cart → pickup → confirm → worker sees it', async () => {
  const fake = fakeTelegram();
  await new Promise((r) => fake.server.listen(0, r));
  const state = path.join(os.tmpdir(), 'nf-telegram-' + process.pid + '.json');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'telegram.js')], {
    env: Object.assign({}, process.env, {
      TELEGRAM_TOKEN: 'test', TELEGRAM_API: 'http://127.0.0.1:' + fake.server.address().port, TELEGRAM_STATE: state,
      TELEGRAM_EXPORTS: path.join(os.tmpdir(), 'nf-exports-' + process.pid), TELEGRAM_AI: 'off'
    }),
    stdio: 'ignore'
  });
  const sent = () => fake.calls.filter((c) => c.method === 'sendMessage' || c.method === 'sendPhoto' || c.method === 'editMessageReplyMarkup');
  let seen = 0;
  const next = (what, test) => until(() => {
    const found = sent().slice(seen).find(test);
    if (found) seen = sent().indexOf(found) + 1;
    return found;
  }, what);
  const keys = (c) => c.params.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);

  try {
    fake.text('/start');
    let m = await next('menú', (c) => c.params.reply_markup);
    assert.match(m.params.text, /Hola Ana/);
    assert.deepEqual(keys(m), ['cat', 'mis', 'info']);

    fake.tap('cat');
    m = await next('categorías', (c) => c.params.reply_markup && keys(c).includes('cat:Frutas'));

    fake.tap('cat:Frutas');
    m = await next('productos', (c) => c.params.reply_markup && keys(c).includes('tgp:mango-tommy'));
    assert.ok(keys(m).includes('tgcart'));

    fake.tap('tgp:mango-tommy');
    m = await next('ficha', (c) => c.method === 'sendPhoto');
    assert.equal(m.params.photo, 'https://userprueda-cyber.github.io/Natural-Fruver/img/productos/mango-tommy.jpg');

    fake.tap('tgq:mango-tommy:1');
    fake.tap('tgq:mango-tommy:1');
    m = await next('cantidad 2', (c) => c.method === 'editMessageReplyMarkup' && JSON.stringify(c.params).includes('2 kg'));

    fake.tap('tgcart');
    m = await next('carrito', (c) => /Carrito/.test(c.params.text || ''));
    assert.match(m.params.text, /2 kg Mango Tommy — \$12\.000/);

    fake.tap('tgsend');
    m = await next('entrega', (c) => c.params.reply_markup && keys(c).includes('ent:recoger'));

    fake.tap('ent:recoger');
    await next('nombre', (c) => /A nombre de quién/.test(c.params.text || ''));
    fake.text('Ana Prueba');
    m = await next('resumen', (c) => c.params.reply_markup && keys(c).includes('ok'));
    assert.match(m.params.text, /Total aprox\.: \$12\.000/);

    fake.tap('ok');
    m = await next('confirmación', (c) => /Pedido NF-0001 recibido/.test(c.params.text || ''));

    fake.text('/trabajador');
    await next('modo trabajador', (c) => /trabajador/.test(c.params.text || ''));
    fake.text('pedidos');
    m = await next('lista de pedidos', (c) => /Pedidos abiertos/.test(c.params.text || ''));
    assert.match(m.params.text, /NF-0001<\/b> · Ana Prueba/);

    fake.text('/pedidos');
    m = await next('/pedidos', (c) => /<b>Pedidos \(1\)<\/b>/.test(c.params.text || ''));
    assert.match(m.params.text, /NF-0001<\/b> · pendiente · \$12\.000[\s\S]*2 kg Mango Tommy/);
    fake.text('/exportar');
    m = await next('/exportar', (c) => /Pedidos\.csv/.test(c.params.text || ''));
    const csv = fs.readFileSync(path.join(os.tmpdir(), 'nf-exports-' + process.pid, 'Pedidos.csv'), 'utf8');
    assert.match(csv, /NF-0001/);
  } finally {
    child.kill();
    fake.server.close();
    fs.rmSync(state, { force: true });
  }
});
