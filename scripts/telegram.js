// Prueba el bot de WhatsApp en Telegram, en este computador.
//
//   1. En Telegram, habla con @BotFather → /newbot → copia el token.
//   2. TELEGRAM_TOKEN=123:abc npm run telegram
//   3. Escríbele "hola" a tu bot.
//
// Corre el código real de apps-script/ (Bot.gs, Orders.gs…) con la hoja simulada en memoria
// (tests/gas-mock.js). No usa Google, Meta ni Cloudflare. El estado se guarda en
// .telegram-state.json para seguir donde ibas; bórralo para empezar de cero.
//
// Diferencias con WhatsApp: el catálogo y el carrito los imita este script (foto + ➖/➕);
// al tocar "Enviar pedido" el bot recibe exactamente el mismo mensaje "order" de WhatsApp.
//
// Comandos de prueba: /trabajador (cambiar entre cliente y trabajador), /reiniciar, /ayuda.

const fs = require('fs');
const path = require('path');
const { createEnv } = require('../tests/gas-mock');
const tg = require('./telegram-adapter');

const TOKEN = process.env.TELEGRAM_TOKEN;
if (!TOKEN) {
  console.error('Falta TELEGRAM_TOKEN. Crea un bot con @BotFather y ejecuta:\n  TELEGRAM_TOKEN=123:abc npm run telegram');
  process.exit(1);
}
const API_BASE = process.env.TELEGRAM_API || 'https://api.telegram.org'; // otra dirección solo para pruebas
const STATE_FILE = process.env.TELEGRAM_STATE || path.join(__dirname, '..', '.telegram-state.json');

// ───────────── Bot con la hoja simulada ─────────────
const env = createEnv();
const known = new Map(); // teléfono (id de chat) → chat de Telegram
const carts = {}; // chat → { productoId: cantidad }

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    const log = console.log;
    console.log = () => {};
    env.gs.setup();
    console.log = log;
    console.log('Hoja nueva con los productos de ejemplo. PIN del administrador: ' + env.gs.table_('Trabajadores').rows[0].pin);
    return;
  }
  const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  Object.entries(s.sheets).forEach(([name, data]) => { env.ss.insertSheet(name).data = data; });
  Object.entries(s.props).forEach(([k, v]) => env.props.set(k, v));
  Object.entries(s.known).forEach(([k, v]) => known.set(k, v));
  Object.assign(carts, s.carts || {});
  console.log('Estado cargado de .telegram-state.json');
}

function saveState() {
  const sheets = {};
  Object.values(env.ss.sheets).forEach((sh) => { sheets[sh.name] = sh.data; });
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    sheets, props: Object.fromEntries(env.props), known: Object.fromEntries(known), carts
  }));
}

loadState();
env.props.set('WA_TOKEN', 'telegram');
env.props.set('WA_PHONE_ID', 'telegram');
env.props.set('WA_CATALOG_ID', 'telegram');

function product(id) {
  const row = env.gs.table_('Productos').rows.find((p) => String(p.id) === id);
  return row ? env.gs.publicProduct_(row, env.gs.todayStr_()) : null;
}

// ───────────── API de Telegram ─────────────
async function api(method, body) {
  const res = await fetch(API_BASE + '/bot' + TOKEN + '/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  });
  const json = await res.json();
  if (!json.ok) console.warn('Telegram ' + method + ': ' + json.description);
  return json;
}

/** Pasa un mensaje al bot y envía a Telegram lo que el bot respondió. */
async function dispatch(message, name) {
  const before = env.fetches.length;
  try {
    env.gs.handlePost_({
      action: 'wa_webhook',
      secret: env.props.get('RELAY_SECRET'),
      payload: { entry: [{ changes: [{ value: { contacts: [{ wa_id: message.from, profile: { name } }], messages: [message] } }] }] }
    });
  } catch (err) {
    console.error('Error del bot:', err);
  }
  const out = env.fetches.slice(before).filter((f) => /\/messages$/.test(f.url) && f.payload && f.payload.type);
  for (const f of out) {
    const chat = tg.chatOf(f.payload.to, known);
    if (!chat) { console.log('  (mensaje para ' + f.payload.to + ', que no es un chat de Telegram)'); continue; }
    for (const call of tg.toTelegramCalls(f.payload, chat, product)) await api(call.method, call.body);
  }
}

// ───────────── Carrito (imita el de WhatsApp) ─────────────
function cartCount(chat) {
  return Object.values(carts[chat] || {}).reduce((s, q) => s + q, 0);
}

async function showCart(chat) {
  const cart = carts[chat] || {};
  const items = Object.entries(cart).filter(([, q]) => q > 0).map(([id, cantidad]) => ({ id, cantidad }));
  if (!items.length) {
    return api('sendMessage', { chat_id: chat, text: '🛒 Tu carrito está vacío.', reply_markup: { inline_keyboard: [[{ text: 'Ver categorías', callback_data: 'cat' }]] } });
  }
  const { lines } = env.gs.priceItems_(items);
  const text = '🛒 <b>Carrito</b>\n' + lines.map((l) => '• ' + l.cantidad + ' ' + (tg.UNITS[l.unidad] || l.unidad) + ' ' + tg.toHtml(l.nombre) + ' — ' + tg.money(l.total)).join('\n') +
    '\n\nTotal: <b>' + tg.money(lines.reduce((s, l) => s + l.total, 0)) + '</b>';
  return api('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: [
    [{ text: '✅ Enviar pedido', callback_data: 'tgsend' }],
    [{ text: '➕ Seguir comprando', callback_data: 'cat' }, { text: '🗑️ Vaciar', callback_data: 'tgclear' }]
  ] } });
}

// ───────────── Comandos de prueba ─────────────
async function toggleWorker(chat, name) {
  const t = env.gs.table_('Trabajadores');
  const phone = tg.phoneOf(chat);
  const mine = t.rows.find((w) => env.gs.samePhone_(w.whatsapp, phone));
  if (mine) {
    env.gs.setCell_(t, mine, 'whatsapp', '');
    return api('sendMessage', { chat_id: chat, text: '👤 Ahora eres <b>cliente</b>. Escribe "hola".', parse_mode: 'HTML' });
  }
  const free = t.rows.find((w) => !String(w.whatsapp || '').trim());
  if (free) env.gs.setCell_(t, free, 'whatsapp', phone);
  else env.gs.writeRow_(t, { nombre: name || 'Trabajador', pin: String(Math.floor(100000 + Math.random() * 900000)), activo: 'si', whatsapp: phone });
  return api('sendMessage', { chat_id: chat, text: '🧑‍🌾 Ahora eres <b>trabajador</b>: te llegan los pedidos nuevos. Escribe "ayuda" para ver los comandos, o "comprar" para pedir como cliente.', parse_mode: 'HTML' });
}

const HELP = 'Comandos de prueba:\n/trabajador — cambiar entre cliente y trabajador\n/reiniciar — vaciar carrito y conversación\n/ayuda — esto';

async function handleUpdate(u) {
  const q = u.callback_query;
  const chat = q ? q.message.chat.id : u.message && u.message.chat.id;
  if (!chat) return;
  known.set(tg.phoneOf(chat), chat);
  const name = tg.profileName(u);
  if (q) api('answerCallbackQuery', { callback_query_id: q.id });

  const text = u.message && u.message.text;
  if (text === '/trabajador') return toggleWorker(chat, name);
  if (text === '/ayuda') return api('sendMessage', { chat_id: chat, text: HELP });
  if (text === '/reiniciar') {
    delete carts[chat];
    const c = env.gs.loadClient_(tg.phoneOf(chat));
    if (c.row._row) env.gs.resetClient_(c);
    return api('sendMessage', { chat_id: chat, text: 'Listo, empezamos de cero. Escribe "hola".' });
  }

  const data = q && q.data;
  if (data === 'tgnoop') return;
  if (data && data.startsWith('tgp:')) {
    const p = product(data.slice(4));
    if (!p) return;
    const call = tg.productCard(chat, p, (carts[chat] || {})[p.id] || 0, cartCount(chat));
    return api(call.method, call.body);
  }
  if (data && data.startsWith('tgq:')) {
    const [, id, delta] = data.split(':');
    const cart = carts[chat] = carts[chat] || {};
    cart[id] = Math.max(0, (cart[id] || 0) + Number(delta));
    if (!cart[id]) delete cart[id];
    const p = product(id);
    const card = tg.productCard(chat, p, cart[id] || 0, cartCount(chat));
    return api('editMessageReplyMarkup', { chat_id: chat, message_id: q.message.message_id, reply_markup: card.body.reply_markup });
  }
  if (data === 'tgcart') return showCart(chat);
  if (data === 'tgclear') { delete carts[chat]; return api('sendMessage', { chat_id: chat, text: '🗑️ Carrito vacío.' }); }
  if (data === 'tgsend') {
    if (!cartCount(chat)) return showCart(chat);
    const order = tg.cartToOrder(chat, carts[chat]);
    delete carts[chat];
    return dispatch(order, name);
  }

  const message = tg.toWhatsAppMessage(u);
  if (message) {
    console.log((q ? '🔘 ' + q.data : '💬 ' + (text || message.type)) + '  (' + (name || chat) + ')');
    await dispatch(message, name);
  }
}

async function main() {
  const me = await api('getMe');
  if (!me.ok) process.exit(1);
  await api('deleteWebhook', { drop_pending_updates: false });
  console.log('Bot listo: https://t.me/' + me.result.username + '  (Ctrl+C para salir)');
  let offset = 0;
  for (;;) {
    let res;
    try {
      res = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
    } catch (err) {
      console.warn('Sin conexión, reintento…', err.message);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    for (const u of res.result || []) {
      offset = u.update_id + 1;
      try { await handleUpdate(u); } catch (err) { console.error(err); }
      saveState();
    }
  }
}

main();
