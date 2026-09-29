// Traduce entre Telegram y el formato de WhatsApp Cloud que usa el bot (apps-script/Bot.gs),
// para probar el bot en Telegram sin cambiar su código. Ver scripts/telegram.js.

const PHOTO_BASE = 'https://userprueda-cyber.github.io/Natural-Fruver/';

// El bot identifica a las personas por teléfono; en Telegram usamos el id del chat.
function phoneOf(chatId) {
  return String(chatId);
}

/** Telegram manda el teléfono del bot con 57 delante si tiene 10 dígitos (waNumber_). */
function chatOf(phone, known) {
  const p = String(phone);
  if (known.has(p)) return known.get(p);
  if (p.startsWith('57') && known.has(p.slice(2))) return known.get(p.slice(2));
  return null;
}

let seq = 0;

/** Update de Telegram → mensaje de WhatsApp (o null si no aplica). */
function toWhatsAppMessage(update) {
  const base = (chatId) => ({ from: phoneOf(chatId), id: 'tg.' + update.update_id + '.' + (++seq), timestamp: String(Math.floor(Date.now() / 1000)) });
  if (update.callback_query) {
    const q = update.callback_query;
    return Object.assign(base(q.message.chat.id), {
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: q.data, title: q.data } }
    });
  }
  const m = update.message;
  if (!m) return null;
  if (m.location) {
    return Object.assign(base(m.chat.id), { type: 'location', location: { latitude: m.location.latitude, longitude: m.location.longitude } });
  }
  if (typeof m.text === 'string') {
    const text = m.text === '/start' ? 'hola' : m.text;
    return Object.assign(base(m.chat.id), { type: 'text', text: { body: text } });
  }
  // Notas de voz y audios: el bot los pide a "Meta" con este id; scripts/telegram.js los baja de Telegram.
  const voice = m.voice || m.audio;
  if (voice) return Object.assign(base(m.chat.id), { type: 'audio', audio: { id: 'tgfile:' + voice.file_id, mime_type: voice.mime_type || 'audio/ogg', voice: !!m.voice } });
  if (m.photo) return Object.assign(base(m.chat.id), { type: 'image', image: { id: 'tgfile:' + m.photo[m.photo.length - 1].file_id, caption: m.caption || '' } });
  if (m.sticker) return Object.assign(base(m.chat.id), { type: 'sticker', sticker: { id: 'tgfile:' + m.sticker.file_id } });
  if (m.document) return Object.assign(base(m.chat.id), { type: 'document', document: { id: 'tgfile:' + m.document.file_id } });
  if (m.video || m.video_note) return Object.assign(base(m.chat.id), { type: 'video', video: {} });
  if (m.contact) return Object.assign(base(m.chat.id), { type: 'contacts', contacts: [{ name: { formatted_name: m.contact.first_name } }] });
  return Object.assign(base(m.chat.id), { type: 'unsupported' });
}

function profileName(update) {
  const u = (update.callback_query && update.callback_query.from) || (update.message && update.message.from) || {};
  return [u.first_name, u.last_name].filter(Boolean).join(' ');
}

/** Carrito de Telegram → mensaje "order" de WhatsApp. */
function cartToOrder(chatId, cart) {
  return {
    from: phoneOf(chatId), id: 'tg.cart.' + (++seq), type: 'order',
    order: {
      catalog_id: 'telegram',
      product_items: Object.entries(cart).filter(([, q]) => q > 0)
        .map(([id, q]) => ({ product_retailer_id: id, quantity: q, item_price: 0, currency: 'COP' }))
    }
  };
}

/** Texto de WhatsApp (*negrita*, _cursiva_) → HTML de Telegram. */
function toHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/gm, '$1<i>$2</i>');
}

const button = (text, data) => ({ text, callback_data: String(data).slice(0, 64) });

/**
 * Mensaje de WhatsApp que el bot quiso enviar → llamadas a la API de Telegram.
 * products: función id → producto público (para nombres y precios de los "catálogos").
 */
function toTelegramCalls(payload, chatId, products) {
  const send = (text, rows) => ({
    method: 'sendMessage',
    body: Object.assign({ chat_id: chatId, text: toHtml(text), parse_mode: 'HTML', disable_web_page_preview: true },
      rows && rows.length ? { reply_markup: { inline_keyboard: rows } } : {})
  });

  if (payload.type === 'text') return [send(payload.text.body)];
  if (payload.type === 'template') {
    const params = ((payload.template.components[0] || {}).parameters || []).map((p) => p.text);
    return [send('📨 [Plantilla "' + payload.template.name + '"] ' + params.join(' · '))];
  }
  if (payload.type !== 'interactive') return [];

  const i = payload.interactive;
  const body = i.body ? i.body.text : '';
  if (i.type === 'button') {
    return [send(body, [i.action.buttons.map((b) => button(b.reply.title, b.reply.id))])];
  }
  if (i.type === 'list') {
    const rows = i.action.sections[0].rows.map((r) => [button(r.title + (r.description ? ' · ' + r.description : ''), r.id)]);
    return [send(body, rows)];
  }
  if (i.type === 'product_list') {
    const ids = i.action.sections[0].product_items.map((p) => p.product_retailer_id);
    const rows = ids.map((id) => {
      const p = products(id);
      return [button(p ? p.nombre + ' · ' + priceLabel(p) : id, 'tgp:' + id)];
    });
    rows.push([button('🛒 Ver carrito', 'tgcart')]);
    return [send('<b>' + (i.header ? i.header.text : 'Productos') + '</b>\n' + body, rows)];
  }
  if (i.type === 'catalog_message') {
    return [send(body + '\n\n(En Telegram el catálogo completo se ve por categorías)', [[button('Ver categorías', 'cat')]])];
  }
  return [send('[' + i.type + '] ' + body)];
}

function money(n) {
  return '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const UNITS = { unidad: 'und', kg: 'kg', lb: 'lb', atado: 'atado', canasta: 'canasta', paquete: 'paq', bandeja: 'bandeja' };
function priceLabel(p) {
  const price = p.oferta !== null && p.oferta !== undefined ? p.oferta : p.precio;
  return money(price) + '/' + (UNITS[p.unidad] || p.unidad);
}

/** Ficha de producto con foto y botones ➖ cantidad ➕, como en el catálogo de WhatsApp. */
function productCard(chatId, p, qty, cartCount) {
  const caption = '<b>' + toHtml(p.nombre) + '</b>\n' +
    (p.oferta !== null && p.oferta !== undefined ? '<s>' + money(p.precio) + '</s> ' : '') + priceLabel(p) +
    (p.descripcion ? '\n' + toHtml(p.descripcion) : '');
  const keyboard = { inline_keyboard: [
    [button('➖', 'tgq:' + p.id + ':-1'), button(qty + ' ' + (UNITS[p.unidad] || p.unidad), 'tgnoop'), button('➕', 'tgq:' + p.id + ':1')],
    [button('🛒 Ver carrito (' + cartCount + ')', 'tgcart')]
  ] };
  if (p.foto) {
    const url = /^https:\/\//.test(p.foto) ? p.foto : PHOTO_BASE + p.foto;
    return { method: 'sendPhoto', body: { chat_id: chatId, photo: url, caption, parse_mode: 'HTML', reply_markup: keyboard } };
  }
  return { method: 'sendMessage', body: { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: keyboard } };
}

module.exports = { phoneOf, chatOf, toWhatsAppMessage, profileName, cartToOrder, toHtml, toTelegramCalls, productCard, priceLabel, money, UNITS };
