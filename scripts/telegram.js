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
// Comandos de prueba: /trabajador (cambiar entre cliente y trabajador), /reiniciar, /ayuda,
// /tareas (correr ya las tareas de cada 5 min), /modo sombra|asistido|autonomo, /ia on|off.
//
// IA local: si Ollama está corriendo (http://localhost:11434) con el modelo OLLAMA_MODEL
// (por defecto qwen2.5:14b), el bot la usa para los mensajes que las reglas no entienden.
// TELEGRAM_AI=off la desactiva. Notas de voz: DEEPGRAM_API_KEY=... para transcribirlas.

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
const { spawnSync } = require('child_process');
const os = require('os');
const env = createEnv();
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:14b';

// ───────────── Red real para IA, audio y archivos (el resto de "Meta" se simula) ─────────────
/** UrlFetchApp es síncrono: usamos curl para llamadas reales (Ollama, Anthropic, Deepgram, archivos de Telegram). */
function realFetch(url, opts) {
  opts = opts || {};
  const tmpOut = path.join(os.tmpdir(), 'nf-out-' + process.pid + '-' + Date.now());
  const args = ['-s', '-m', '180', '-X', String(opts.method || 'get').toUpperCase(), '-o', tmpOut, '-w', '%{http_code}'];
  const headers = Object.assign({}, opts.headers || {});
  if (opts.contentType) headers['Content-Type'] = opts.contentType;
  Object.entries(headers).forEach(([k, v]) => args.push('-H', k + ': ' + v));
  let tmpIn = null;
  if (opts.payload !== undefined && opts.payload !== null) {
    tmpIn = path.join(os.tmpdir(), 'nf-in-' + process.pid + '-' + Date.now());
    const data = typeof opts.payload === 'string' ? opts.payload : Buffer.from(opts.payload);
    fs.writeFileSync(tmpIn, data);
    args.push('--data-binary', '@' + tmpIn);
  }
  args.push(url);
  const r = spawnSync('curl', args, { encoding: 'utf8' });
  const status = Number(r.stdout) || 0;
  let bytes = Buffer.alloc(0);
  try { bytes = fs.readFileSync(tmpOut); fs.unlinkSync(tmpOut); } catch (e) { /* sin respuesta */ }
  if (tmpIn) try { fs.unlinkSync(tmpIn); } catch (e) { /* nada */ }
  if (!status) return { status: 0, throws: 'Sin conexión con ' + new URL(url).host };
  return { status, body: bytes.toString('utf8'), bytes };
}

function telegramFile(fileId) {
  const r = realFetch(API_BASE + '/bot' + TOKEN + '/getFile', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ file_id: fileId }) });
  try {
    const j = JSON.parse(r.body);
    if (j.ok) return { url: API_BASE + '/file/bot' + TOKEN + '/' + j.result.file_path, size: j.result.file_size || 0 };
  } catch (e) { /* nada */ }
  return null;
}

env.net.reply = (url, payload, opts) => {
  const u = String(url);
  if (u.startsWith('https://graph.facebook.com/')) {
    const m = u.match(/\/(tgfile(?:%3A|:)[^/?]+)$/);
    if (m) {
      const f = telegramFile(decodeURIComponent(m[1]).slice(7));
      return f ? { status: 200, body: { url: f.url, mime_type: 'audio/ogg', file_size: f.size } } : { status: 404, body: { error: { message: 'no file' } } };
    }
    return null; // lo demás de Meta se simula y se traduce a Telegram
  }
  return realFetch(u, opts);
};
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
if (process.env.DEEPGRAM_API_KEY) env.props.set('DEEPGRAM_API_KEY', process.env.DEEPGRAM_API_KEY);
if (process.env.ANTHROPIC_API_KEY) env.props.set('ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY);
env.gs.migrateSchema_();

function setConfig(key, value) {
  const t = env.gs.table_('Config');
  const row = t.rows.find((r) => String(r.clave).trim() === key);
  if (row) env.gs.setCell_(t, row, 'valor', value);
  else env.gs.writeRow_(t, { clave: key, valor: value, nota: '' });
}

// En Telegram los mensajes llegan uno por uno: no hace falta esperar ráfagas.
setConfig('espera_rafaga_seg', 0);
if (process.env.DEEPGRAM_API_KEY) setConfig('audio_activo', 'si');
(function setupAi() {
  if (process.env.TELEGRAM_AI === 'off') { setConfig('ia_activa', 'no'); console.log('IA desactivada (TELEGRAM_AI=off).'); return; }
  if (process.env.ANTHROPIC_API_KEY && process.env.TELEGRAM_AI === 'anthropic') {
    setConfig('ia_activa', 'si'); setConfig('ia_proveedor', 'anthropic'); setConfig('ia_modelo', 'claude-haiku-4-5');
    console.log('IA: Claude Haiku 4.5 (Anthropic).');
    return;
  }
  const r = realFetch(OLLAMA_URL + '/api/tags', {});
  let models = [];
  try { models = JSON.parse(r.body).models.map((m) => m.name); } catch (e) { /* sin Ollama */ }
  if (!models.length) { setConfig('ia_activa', 'no'); console.log('IA: Ollama no está corriendo en ' + OLLAMA_URL + ' → el bot funciona solo con reglas.'); return; }
  const model = models.includes(OLLAMA_MODEL) ? OLLAMA_MODEL : models[0];
  setConfig('ia_activa', 'si'); setConfig('ia_proveedor', 'ollama'); setConfig('ia_url', OLLAMA_URL); setConfig('ia_modelo', model);
  console.log('IA local: Ollama ' + model + ' (solo para mensajes que las reglas no entienden).');
})();

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
  await deliver(before);
}

/** Envía a Telegram lo que el bot mandó a "WhatsApp" desde la posición before. */
async function deliver(before) {
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

const HELP = 'Comandos de prueba:\n/trabajador — cambiar entre cliente y trabajador\n/reiniciar — vaciar carrito y conversación\n' +
  '/tareas — correr ya las tareas de cada 5 minutos\n/modo sombra|asistido|autonomo\n/ia on|off — IA local (Ollama)\n/ayuda — esto';

async function handleUpdate(u) {
  const q = u.callback_query;
  const chat = q ? q.message.chat.id : u.message && u.message.chat.id;
  if (!chat) return;
  known.set(tg.phoneOf(chat), chat);
  const name = tg.profileName(u);
  if (q) api('answerCallbackQuery', { callback_query_id: q.id });

  const text = u.message && u.message.text;
  if (text === '/trabajador') return toggleWorker(chat, name);
  if (text === '/tareas') {
    const before = env.fetches.length;
    env.gs.runEveryFiveMinutes();
    await deliver(before);
    return api('sendMessage', { chat_id: chat, text: 'Tareas de cada 5 minutos ejecutadas.' });
  }
  if (text && text.startsWith('/modo ')) { setConfig('modo_bot', text.slice(6).trim()); return api('sendMessage', { chat_id: chat, text: 'modo_bot = ' + text.slice(6).trim() }); }
  if (text === '/ia off' || text === '/ia on') { setConfig('ia_activa', text === '/ia on' ? 'si' : 'no'); return api('sendMessage', { chat_id: chat, text: 'ia_activa = ' + (text === '/ia on' ? 'si' : 'no') }); }
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
    api('sendChatAction', { chat_id: chat, action: 'typing' });
    await dispatch(message, name);
  }
}

async function main() {
  const me = await api('getMe');
  if (!me.ok) process.exit(1);
  await api('deleteWebhook', { drop_pending_updates: false });
  console.log('Bot listo: https://t.me/' + me.result.username + '  (Ctrl+C para salir)');
  let offset = 0;
  // Tareas de cada 5 minutos (escalar asesor, reintentos, recordatorios), aquí cada minuto.
  setInterval(async () => {
    const before = env.fetches.length;
    try { env.gs.runEveryFiveMinutes(); await deliver(before); saveState(); } catch (err) { console.error('Tareas:', err.message); }
  }, 60000);
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
