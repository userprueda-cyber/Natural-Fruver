/**
 * Bot de WhatsApp.
 *
 * Meta envía cada mensaje al relé de Cloudflare (relay/worker.js), que revisa
 * la firma y lo reenvía aquí como { action: 'wa_webhook', secret, payload }.
 *
 * Clientes:  escriben lo que quieren ("2 libras de tomate y un aguacate") o usan el
 *            catálogo de WhatsApp → carrito → domicilio o recoger → dirección → nombre
 *            → forma de pago → confirmar. Preguntas de horario, precios, domicilios.
 *            Asesor humano cuando lo piden o cuando el bot no entiende.
 * Trabajadores (número en la pestaña Trabajadores): comandos como
 *            "pedidos", "confirmar 12", "precio mango 5500", "agotado fresa", "pausar".
 *
 * Orden de las capas: protecciones (Guards.gs) → normalizar y reglas (Nlu.gs)
 * → IA solo si hace falta (Llm.gs) → validar → respuesta con plantillas de aquí.
 */

var SESSION_HOURS = 12;
var SEEN_SECONDS = 6 * 3600;
var MAX_TEXT_CHARS = 1500;
var GREETINGS = ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'menu', 'inicio', 'empezar', 'hi', 'ola', 'buen dia'];
// Intenciones que interrumpen un paso (dirección, nombre…) y se atienden de inmediato.
var BREAKING_INTENTS = ['human', 'complaint', 'cancel_order', 'optout', 'privacy_view', 'privacy_delete', 'abuse', 'injection',
  'owner_claim', 'health', 'hours', 'location', 'payment_info', 'delivery_info', 'status', 'robot', 'payment_claim', 'my_orders'];

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function handleWebhook_(body) {
  if (!secret_('RELAY_SECRET') || !safeEqual_(String(body.secret || ''), secret_('RELAY_SECRET'))) {
    throw userError_('permiso', 'No autorizado.');
  }
  try { migrateSchema_(); } catch (e) { console.warn('Migración: ' + e); }
  var handled = 0;
  var myPhoneId = secret_('WA_PHONE_ID');
  var payload = body.payload || {};
  (payload.entry || []).forEach(function (entry) {
    (entry.changes || []).forEach(function (change) {
      var value = change.value || {};
      // Solo eventos de NUESTRO número.
      var pid = value.metadata && value.metadata.phone_number_id;
      if (pid && myPhoneId && String(pid) !== String(myPhoneId)) return;
      (value.statuses || []).forEach(function (st) {
        try { handleStatus_(st); } catch (e) { console.warn('Estado: ' + e); }
      });
      var echoes = (value.message_echoes || []).concat(change.field === 'smb_message_echoes' ? (value.messages || []) : []);
      echoes.forEach(function (e) { try { handleEcho_(e); } catch (err) { console.warn('Eco: ' + err); } });
      if (change.field === 'smb_message_echoes') return;
      var names = {};
      (value.contacts || []).forEach(function (c) { names[c.wa_id] = c.profile && c.profile.name; });
      var msgs = (value.messages || []).slice().sort(function (a, b) { return num_(a.timestamp, 0) - num_(b.timestamp, 0); });
      msgs.forEach(function (msg) {
        if (alreadySeen_(msg.id)) return;
        if (tooOld_(msg)) { bumpMetric_('ignorados'); return; }
        handled++;
        try {
          handleMessage_(msg, names[msg.from] || '');
        } catch (err) {
          console.error(err && err.stack || err);
          failSoft_(String(msg.from || ''), err);
        }
      });
    });
  });
  return { ok: true, mensajes: handled };
}

/** Si algo se rompe, el cliente recibe un mensaje honesto y el equipo un aviso (máx. 1 cada 10 min). */
function failSoft_(from, err) {
  if (!from) return;
  try {
    waText_(from, 'Uy, estamos con un inconveniente 😕. Ya le avisé a una persona del equipo para que te escriba en breve.', { direct: true });
  } catch (e) { /* sin WhatsApp no hay nada más que hacer */ }
  if (onceEvery_('falla_aviso', 600)) {
    try { alertStaff_('⚠️ El bot tuvo un error con el cliente +' + waNumber_(from) + '. Escríbele desde la app.\n' + String(err).slice(0, 200), null, { email: true }); } catch (e) { /* nada */ }
  }
}

/** Meta a veces reenvía el mismo mensaje: se atiende una sola vez. */
function alreadySeen_(id) {
  if (!id) return false;
  var cache = CacheService.getScriptCache();
  if (cache.get('wa_' + id)) return true;
  cache.put('wa_' + id, '1', SEEN_SECONDS);
  return false;
}

/** Mensajes de más de 24 h (reintentos viejos tras una caída larga) no se responden. */
function tooOld_(msg) {
  var ts = num_(msg.timestamp, 0);
  return ts > 1e9 && new Date().getTime() / 1000 - ts > 24 * 3600;
}

/** Mensaje de Meta → { kind: 'text'|'reply'|'order'|'location'|'audio'|'image'|…, ... } */
function parseIncoming_(msg) {
  switch (msg.type) {
    case 'text':
      return { kind: 'text', text: String((msg.text && msg.text.body) || '').trim() };
    case 'interactive':
      var i = msg.interactive || {};
      var r = i.button_reply || i.list_reply || {};
      return { kind: 'reply', id: String(r.id || ''), title: String(r.title || '') };
    case 'button':
      return { kind: 'reply', id: String((msg.button && msg.button.payload) || ''), title: String((msg.button && msg.button.text) || '') };
    case 'order':
      return {
        kind: 'order',
        items: ((msg.order && msg.order.product_items) || []).map(function (it) {
          return { id: String(it.product_retailer_id || ''), cantidad: num_(it.quantity, 0) };
        })
      };
    case 'location':
      var l = msg.location || {};
      return { kind: 'location', text: [l.name, l.address].filter(Boolean).join(', '), lat: l.latitude, lng: l.longitude };
    case 'audio':
      return { kind: 'audio', id: String((msg.audio && msg.audio.id) || '') };
    case 'image':
      return { kind: 'image', id: String((msg.image && msg.image.id) || ''), caption: String((msg.image && msg.image.caption) || '') };
    case 'sticker':
      return { kind: 'sticker' };
    case 'reaction':
      return { kind: 'reaction', emoji: String((msg.reaction && msg.reaction.emoji) || '') };
    case 'video':
    case 'document':
      return { kind: 'file', type: msg.type };
    case 'contacts':
      return { kind: 'contacts' };
    case 'edit':
      var e = (msg.edit && msg.edit.message) || {};
      return { kind: 'text', text: String((e.text && e.text.body) || '').trim(), edited: true };
    case 'revoke':
    case 'deleted':
      return { kind: 'deleted' };
    default:
      return { kind: 'other', type: msg.type };
  }
}

function handleMessage_(msg, profileName) {
  var from = String(msg.from || '');
  if (!from) return;
  var input = parseIncoming_(msg);
  var worker = workerByPhone_(from);
  if (worker && handleWorker_(from, worker, input)) return;
  var cfg = getConfig_();
  // Ráfagas: "hola" / "me regala" / "2 libras de tomate" se leen como un solo mensaje.
  if (input.kind === 'text' && !worker) {
    var merged = collectBurst_(from, input.text, msg.id, cfg);
    if (merged === null) return;
    input.text = merged;
  }
  handleCustomer_(from, input, profileName, cfg);
}

/**
 * Espera unos segundos por si el cliente sigue escribiendo. Solo la última ejecución
 * responde, con todos los textos juntos. Devuelve el texto combinado o null.
 */
function collectBurst_(from, text, id, cfg) {
  var wait = num_(cfg.espera_rafaga_seg, 0);
  if (!(wait > 0)) return text;
  var cache = CacheService.getScriptCache();
  var key = 'burst_' + from;
  var list = JSON.parse(cache.get(key) || '[]');
  list.push({ id: id, t: text });
  cache.put(key, JSON.stringify(list), 120);
  Utilities.sleep(Math.min(wait, 10) * 1000);
  list = JSON.parse(cache.get(key) || '[]');
  if (!list.length || list[list.length - 1].id !== id) return null;
  cache.remove(key);
  return list.map(function (x) { return x.t; }).join('\n');
}

// ───────────────────────── Clientes ─────────────────────────

function loadClient_(phone) {
  var t = table_(SHEETS.CLIENTS);
  var row = null;
  t.rows.forEach(function (r) { if (samePhone_(r.telefono, phone)) row = r; });
  if (!row) row = { telefono: phone, nombre: '', direccion: '', paso: '', datos: '' };
  var data;
  try { data = JSON.parse(row.datos || '{}'); } catch (e) { data = {}; }
  var last = toDate_(row.actualizado);
  if (row.paso && last && new Date().getTime() - last.getTime() > SESSION_HOURS * 3600 * 1000) {
    row.paso = '';
    data = { perfil: data.perfil, aviso_datos: data.aviso_datos, turnos: data.turnos, version: data.version || 0 };
  }
  return { t: t, row: row, data: data };
}

function saveClient_(c) {
  c.row.datos = JSON.stringify(c.data || {});
  c.row.actualizado = new Date();
  writeRow_(c.t, c.row);
}

function resetClient_(c) {
  c.row.paso = '';
  // version nunca vuelve a cero: es parte de la clave que evita pedidos dobles.
  c.data = { perfil: c.data.perfil, aviso_datos: c.data.aviso_datos, turnos: c.data.turnos, lang: c.data.lang, version: c.data.version || 0 };
  saveClient_(c);
}

/** Clave de idempotencia: el mismo carrito (versión + contenido) confirmado dos veces es un solo pedido. */
function orderKey_(from, c) {
  var items = (c.data.carrito || []).map(function (x) { return x.id + '=' + x.cantidad; }).sort().join(',');
  var h = 0;
  for (var i = 0; i < items.length; i++) h = (h * 31 + items.charCodeAt(i)) | 0;
  return from + ':' + (c.data.version || 0) + ':' + (h >>> 0).toString(36);
}

function pushTurn_(c, who, text) {
  var turns = c.data.turnos || [];
  turns.push({ r: who, t: clip_(redact_(text), 200) });
  c.data.turnos = turns.slice(-6);
}

function handleCustomer_(from, input, profileName, cfg) {
  cfg = cfg || getConfig_();
  var c = loadClient_(from);
  if (!c.row.nombre && profileName) c.data.perfil = clip_(profileName, 80);
  c.row.ultimo_mensaje = new Date();
  c.row.recordatorio = '';
  bumpMetric_('mensajes');

  // ── Capa 0: protecciones ──
  if (truthy_(c.row.bloqueado) || /^auto/.test(String(c.row.bloqueado || ''))) { saveClient_(c); return; }
  var rl = rateLimit_(from, cfg);
  if (rl === 'drop') { saveClient_(c); return; }
  if (rl === 'block') {
    c.row.bloqueado = 'auto ' + nowStr_();
    saveClient_(c);
    alertStaff_('🚫 Bloqueé a +' + waNumber_(from) + ' por mandar demasiados mensajes. Para desbloquear escribe: desbloquear ' + from);
    return;
  }
  if (rl === 'warn') {
    saveClient_(c);
    return waText_(from, 'Recibí muchos mensajes seguidos 😅. Dame un momento y escríbeme con calma.');
  }
  if (isPaused_(cfg)) {
    saveClient_(c);
    if (onceEvery_('pausa_' + from, 6 * 3600)) waText_(from, 'Hola 👋 En este momento te atiende una persona del equipo. Te responde en breve 🙏', { direct: true });
    return;
  }
  if (handoffActive_(c)) {
    if (handoffExpired_(c, cfg)) {
      c.row.asesor = ''; c.row.asesor_desde = ''; c.row.asesor_ultimo = ''; c.row.asesor_motivo = '';
      c.data.fallos = 0;
      c.data.volvio = true;
    } else {
      if (input.kind === 'text') pushTurn_(c, 'c', input.text);
      saveClient_(c);
      return; // una persona atiende este chat: el bot no interrumpe
    }
  }
  if (recordConsent_(c)) audit_('cliente', from, 'autorizacion_datos', CONSENT_VERSION);

  switch (input.kind) {
    case 'order': return receiveCart_(from, c, cfg, input.items);
    case 'reply': return customerReply_(from, c, cfg, input.id);
    case 'location': return handleLocation_(from, c, cfg, input);
    case 'audio': return handleAudio_(from, c, cfg, input);
    case 'image':
      var reason = c.row.paso === 'confirmar' || /pag|comprobante|transfer|nequi/i.test(input.caption) || lastOpenOrder_(from) ? 'pago' : 'imagen';
      return startHandoff_(from, c, cfg, reason, reason === 'pago'
        ? 'Recibí tu imagen 📷. Una persona verifica el pago en la cuenta y te confirma por aquí 🙏'
        : 'Recibí tu imagen 📷. Una persona la revisa y te responde por aquí 🙌', input.caption);
    case 'file':
      saveClient_(c);
      return waButtons_(from, 'No puedo abrir archivos ni videos 🙏. ¿Me escribes lo que necesitas?', [
        { id: 'cat', title: '🛒 Hacer pedido' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]);
    case 'sticker':
      saveClient_(c);
      return waButtons_(from, '😄 ¿En qué te ayudo?', [{ id: 'cat', title: '🛒 Hacer pedido' }, { id: 'info', title: 'ℹ️ Horario y envíos' }]);
    case 'reaction':
      if (THUMBS_UP_RE.test(input.emoji) && c.row.paso === 'confirmar') {
        saveClient_(c);
        return waButtons_(from, '👍 ¿Confirmo tu pedido?', [{ id: 'ok', title: '✅ Confirmar' }, { id: 'cancelar', title: '❌ Cancelar' }]);
      }
      saveClient_(c);
      return;
    case 'contacts':
      saveClient_(c);
      return waText_(from, 'Recibí un contacto 👤. Si el pedido es para otra persona, escríbeme la dirección y el nombre cuando te los pida 😊');
    case 'deleted':
      saveClient_(c);
      return; // borrar un mensaje nunca borra pedidos
    case 'text':
      return handleText_(from, c, cfg, input.text, input);
    default:
      saveClient_(c);
      return sendMenu_(from, c, cfg);
  }
}

function handleText_(from, c, cfg, raw, input) {
  var text = String(raw || '').trim();
  if (text.length > MAX_TEXT_CHARS) {
    saveClient_(c);
    return waButtons_(from, 'Tu mensaje es muy largo para mí 🙈. ¿Me lo resumes en pocas líneas (por ejemplo: *2 libras de tomate, 1 kilo de papa*)?', [
      { id: 'cat', title: '🛒 Ver productos' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]);
  }
  var sensitive = sensitiveData_(text);
  if (sensitive) {
    text = redact_(text);
    waText_(from, '🔒 Por tu seguridad, no compartas números de tarjeta, cédula ni claves por aquí. No los guardé.');
  }
  if (isEmojiOnly_(text)) {
    if (THUMBS_UP_RE.test(text) && c.row.paso === 'confirmar') return confirmOrder_(from, c, cfg);
    saveClient_(c);
    return waButtons_(from, '😊 ¿En qué te puedo ayudar?', [
      { id: 'cat', title: '🛒 Hacer pedido' }, { id: 'info', title: 'ℹ️ Horario y envíos' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]);
  }
  if (text.length > LLM_MAX_INPUT_CHARS) text = text.slice(0, LLM_MAX_INPUT_CHARS);
  var norm = normText_(text);
  pushTurn_(c, 'c', text);
  if (botLoop_(from, norm)) {
    saveClient_(c);
    if (onceEvery_('loop_' + from, 3600)) alertStaff_('🔁 +' + waNumber_(from) + ' parece un contestador automático repitiendo el mismo mensaje. Dejé de responderle.');
    return;
  }
  if (norm === 'alta' || norm === 'suscribir') {
    setOptOut_(c, false);
    return waText_(from, 'Listo ✅, de nuevo te podemos escribir para avisarte de tus pedidos.');
  }
  var intent = detectIntent_(norm, text);
  if (looksEnglish_(norm)) c.data.lang = 'en';
  if (handleStep_(from, c, cfg, text, norm, intent)) return;
  return routeIntent_(from, c, cfg, text, norm, intent);
}

/** Respuestas que dependen del paso en que va el cliente. true = ya se atendió. */
function handleStep_(from, c, cfg, text, norm, intent) {
  var paso = c.row.paso;
  if (!paso || BREAKING_INTENTS.indexOf(intent) >= 0) return false;

  if (paso === 'direccion?' && (intent === 'affirm' || /^(si|esa|misma|la misma|ok)$/.test(norm))) { nextStep_(from, c, cfg); return true; }
  if (paso === 'direccion' || paso === 'direccion?') {
    if (GREETINGS.indexOf(norm) >= 0) return false;
    captureAddress_(from, c, cfg, text);
    return true;
  }
  if (paso === 'nombre') {
    if (text.length < 2 || intent === 'order' || intent === 'price') { waText_(from, '¿A nombre de quién va el pedido?'); saveClient_(c); return true; }
    c.row.nombre = clip_(text.replace(/^(a nombre de|mi nombre es|me llamo|soy)\s+/i, ''), 80);
    nextStep_(from, c, cfg);
    return true;
  }
  if (paso === 'nota') {
    c.data.notas = clip_((c.data.notas ? c.data.notas + '. ' : '') + text, 300);
    c.row.paso = 'confirmar';
    saveClient_(c);
    sendSummary_(from, c, cfg);
    return true;
  }
  if (paso === 'pago') {
    var methods = paymentMethods_(cfg);
    var pick = methods.filter(function (m) { return normalize_(m).indexOf(norm) >= 0 || norm.indexOf(normalize_(m).split(' ')[0]) >= 0; })[0];
    if (pick) { c.data.pago = pick; nextStep_(from, c, cfg); return true; }
    if (intent === 'unknown' || intent === 'affirm' || intent === 'deny') { askPayment_(from, c, cfg); return true; }
    return false;
  }
  if (paso === 'entrega') {
    if (/recog|recoj|paso por|voy por|en la tienda|tienda/.test(norm)) { chooseDelivery_(from, c, cfg, 'recoger'); return true; }
    if (/domicilio|traigan|lleven|manden|envien|a la casa/.test(norm)) { chooseDelivery_(from, c, cfg, 'domicilio'); return true; }
    if (['order', 'change', 'remove', 'price', 'availability'].indexOf(intent) >= 0) return false;
    askDelivery_(from, c, 'Elige una opción con los botones 👇');
    return true;
  }
  if (paso === 'pregunta') return answerQuestion_(from, c, cfg, text, norm, intent);
  if (paso === 'confirmar') {
    if (intent === 'affirm' || intent === 'finish') { confirmOrder_(from, c, cfg); return true; }
    if (intent === 'deny') {
      saveClient_(c);
      waButtons_(from, '¿Qué quieres cambiar?', [
        { id: 'mas', title: '🛒 Agregar o quitar' }, { id: 'dir:otra', title: '📍 Otra dirección' }, { id: 'cancelar', title: '❌ Cancelar pedido' }]);
      return true;
    }
    if (['order', 'change', 'remove', 'address_change', 'repeat', 'price', 'availability'].indexOf(intent) >= 0) return false;
    if (GREETINGS.indexOf(norm) >= 0) return false;
    c.data.notas = clip_((c.data.notas ? c.data.notas + '. ' : '') + text, 300);
    saveClient_(c);
    sendSummary_(from, c, cfg);
    return true;
  }
  return false;
}

/** Intenciones que no dependen del paso. */
function routeIntent_(from, c, cfg, text, norm, intent) {
  var hadCart = (c.data.carrito || []).length > 0;
  switch (intent) {
    case 'optout':
      setOptOut_(c, true);
      return waText_(from, 'Listo ✅. No te enviaremos mensajes automáticos (recordatorios ni avisos). Si nos escribes, te respondemos. Para volver a recibirlos escribe *alta*.');
    case 'privacy_view': saveClient_(c); return sendMyData_(from, c);
    case 'privacy_delete': saveClient_(c); return askDeleteData_(from);
    case 'human': return startHandoff_(from, c, cfg, 'pedido', '', text);
    case 'complaint':
      var openNow = (openState_(cfg.horario, null, cfg.horario_festivos) || { open: true }).open;
      return startHandoff_(from, c, cfg, 'queja', 'Lamento mucho lo que pasó 😔. Ya le paso tu caso a una persona del equipo para que lo solucione. ' +
        (openNow ? 'Te escribe en breve 🙏' : 'Te escribe apenas abramos 🙏'), text);
    case 'health':
      return startHandoff_(from, c, cfg, 'salud', 'No puedo dar recomendaciones de salud ni sobre alergias 🙏. Te paso con una persona del equipo para que te cuente lo que sabemos del producto.', text);
    case 'abuse':
      var n = abuseStrike_(from);
      saveClient_(c);
      audit_('bot', from, 'grosería', text);
      if (n === 1) return waText_(from, 'Estoy aquí para ayudarte con tus pedidos 🙏. Te pido que mantengamos el respeto.');
      if (n === 2) alertStaff_('⚠️ +' + waNumber_(from) + ' está enviando mensajes ofensivos. El bot dejó de responderle hoy. Para bloquearlo: bloquear ' + from);
      return;
    case 'injection':
    case 'owner_claim':
      saveClient_(c);
      audit_('bot', from, 'intento_manipulacion', text);
      logUnresolved_(from, text, 'manipulacion');
      return waButtons_(from, 'Solo puedo ayudarte con pedidos, precios y horarios de la tienda 😊. Los precios y promociones no se cambian por chat.', [
        { id: 'cat', title: '🛒 Hacer pedido' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]);
    case 'robot':
      saveClient_(c);
      return waButtons_(from, 'Soy el asistente automático de la tienda 😊. Si prefieres, te paso con una persona.', [
        { id: 'cat', title: '🛒 Hacer pedido' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]);
    case 'payment_claim':
      return startHandoff_(from, c, cfg, 'pago', '¡Gracias! 🙏 Una persona verifica el pago en la cuenta y te confirma por aquí.', text);
    case 'discount':
      saveClient_(c);
      return waButtons_(from, 'Los precios son los del catálogo 😊, pero mira las ofertas de hoy 🏷️', [
        { id: 'cat:*ofertas', title: '🏷️ Ver ofertas' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]);
    case 'cancel_order': saveClient_(c); return customerCancel_(from, c, cfg);
    case 'status': saveClient_(c); return sendStatus_(from, c);
    case 'my_orders': saveClient_(c); return sendMyOrders_(from);
    case 'repeat': return repeatLastOrder_(from, c, cfg);
    case 'hours':
    case 'location':
    case 'delivery_info':
      saveClient_(c);
      return sendInfo_(from, cfg, c);
    case 'payment_info': saveClient_(c); return sendPaymentInfo_(from, cfg, c);
    case 'offers': saveClient_(c); return sendCategory_(from, '*ofertas');
    case 'catalog': saveClient_(c); return sendCategories_(from, cfg);
    case 'address_change':
      c.data.solo_direccion = !c.row.paso;
      c.row.paso = 'direccion';
      saveClient_(c);
      return waText_(from, '📍 Escribe la nueva dirección: barrio, calle y número, y alguna referencia. También puedes enviar tu ubicación.');
    case 'thanks':
      saveClient_(c);
      if (hadCart && c.row.paso) return waButtons_(from, '¡Con gusto! 💚 ¿Seguimos con tu pedido?', [{ id: 'seguir', title: '🛒 Seguir pedido' }, { id: 'menu', title: '🏠 Menú' }]);
      return waButtons_(from, '¡Con gusto! 💚 Aquí estoy cuando necesites.', [{ id: 'cat', title: '🛒 Hacer pedido' }, { id: 'menu', title: '🏠 Menú' }]);
    case 'greeting':
    case 'empty':
      if (c.row.paso && hadCart) { saveClient_(c); return resumeFlow_(from, c, cfg, '¡Hola de nuevo! 👋 Tengo tu pedido guardado.'); }
      if (c.row.paso) resetClient_(c); else saveClient_(c);
      return sendMenu_(from, c, cfg);
    case 'affirm':
    case 'finish':
      if (hadCart) return finishCart_(from, c, cfg);
      saveClient_(c);
      return sendMenu_(from, c, cfg);
    case 'deny':
      saveClient_(c);
      if (hadCart) return sendCart_(from, c, cfg, 'Listo 👍.');
      return waButtons_(from, 'Listo 👍. ¿Te ayudo con algo más?', [{ id: 'cat', title: '🛒 Hacer pedido' }, { id: 'menu', title: '🏠 Menú' }]);
    case 'remove': return cartRemove_(from, c, cfg, norm);
    case 'change': return cartChange_(from, c, cfg, norm);
    case 'price': return priceQuery_(from, c, cfg, norm, false);
    case 'availability': return priceQuery_(from, c, cfg, norm, true);
    case 'offtopic':
      c.data.fuera = (c.data.fuera || 0) + 1;
      saveClient_(c);
      logUnresolved_(from, text, 'fuera_de_tema');
      if (c.data.fuera > 1) return; // segunda vez: no se responde a temas ajenos a la tienda
      return waButtons_(from, 'Solo puedo ayudarte con pedidos, precios, horarios y domicilios de Natural Fruver 😊', [
        { id: 'cat', title: '🛒 Hacer pedido' }, { id: 'info', title: 'ℹ️ Horario y envíos' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]);
    default:
      return orderOrSearch_(from, c, cfg, text, norm, intent);
  }
}

// ───────────────────────── Pedido escrito ─────────────────────────

/** Pedido escrito, búsqueda de un producto o, si nada funciona, IA → aclaración → asesor. */
function orderOrSearch_(from, c, cfg, text, norm, intent) {
  var index = productIndex_();
  var units = unitTable_();
  // "y de cebolla?" justo después de preguntar un precio: es otra pregunta de precio.
  if (c.data.ultima === 'price' && /^y\b/.test(norm)) return priceQuery_(from, c, cfg, norm, false, index);
  var parsed = parseOrderText_(norm, index, units);
  var hasQty = parsed.items.length > 0 || parsed.asks.some(function (a) { return a.qty !== null && a.qty !== undefined; });
  var anything = parsed.items.length || parsed.asks.length;
  if (anything && (hasQty || intent === 'order')) {
    bumpMetric_('sin_ia');
    return addParsed_(from, c, cfg, parsed);
  }
  if (anything) {
    // Solo el nombre de un producto ("mangos"): mostrarlo con foto y precio.
    var found = findProducts_(text, true);
    if (found.length) {
      bumpMetric_('sin_ia');
      c.data.fallos = 0;
      c.data.ultima = 'search';
      saveClient_(c);
      return waProducts_(from, 'Resultados', 'Encontré ' + found.length + (found.length === 1 ? ' producto' : ' productos') +
        ' para "' + cut_(text, 40) + '". Agrégalos al carrito 🛒 y envíanos el carrito, o escríbeme la cantidad (ej: *2 libras*).', found.slice(0, 60).map(function (p) { return p.id; }));
    }
    bumpMetric_('sin_ia');
    return addParsed_(from, c, cfg, parsed);
  }
  if (parsed.missing.length && intent === 'order') {
    var notFoundAll = parsed.missing.every(function (m) { return !m.options.length; });
    if (!notFoundAll) { bumpMetric_('sin_ia'); return addParsed_(from, c, cfg, parsed); }
  }
  // Capa 3: IA (si está activa y hay presupuesto).
  var ai = llmUnderstand_(cfg, from, text, cartState_(c), c.data.turnos, index);
  if (ai.ok) {
    var v = ai.value;
    if (v.injection_suspected) return routeIntent_(from, c, cfg, text, norm, 'injection');
    if (v.wants_human || v.sentiment === 'angry') return routeIntent_(from, c, cfg, text, norm, v.intent === 'complaint' ? 'complaint' : 'human');
    var fromAi = aiToParsed_(v, index, units);
    // Si trae productos con cantidad es un pedido, aunque el modelo lo haya clasificado distinto.
    var looksLikeOrder = v.items.some(function (it) { return it.product_id && it.qty !== null; }) &&
      ['price', 'availability', 'remove', 'complaint', 'cancel_order'].indexOf(v.intent) < 0;
    if ((looksLikeOrder || v.intent === 'order' || v.intent === 'change' || v.intent === 'unknown') && (fromAi.items.length || fromAi.asks.length)) {
      return v.intent === 'change' ? applyChange_(from, c, cfg, fromAi) : addParsed_(from, c, cfg, fromAi);
    }
    var mapped = { price: 'price', availability: 'availability', hours: 'hours', location: 'location', delivery_info: 'delivery_info',
      payment_info: 'payment_info', status: 'status', cancel_order: 'cancel_order', complaint: 'complaint', human: 'human',
      thanks: 'thanks', affirm: 'affirm', deny: 'deny', greeting: 'greeting', offtopic: 'offtopic', remove: 'remove' }[v.intent];
    if (mapped && (mapped === 'price' || mapped === 'availability' || mapped === 'remove') && fromAi.items.length + fromAi.asks.length) {
      var names = fromAi.items.concat(fromAi.asks).map(function (x) { return x.p ? x.p.nombre : (x.options && x.options[0] && x.options[0].p.nombre) || ''; }).join(' ');
      return mapped === 'remove' ? cartRemove_(from, c, cfg, normText_(names)) : priceQuery_(from, c, cfg, normText_(names), mapped === 'availability', index);
    }
    if (mapped && mapped !== 'price' && mapped !== 'availability' && mapped !== 'remove') return routeIntent_(from, c, cfg, text, norm, mapped);
  }
  return misunderstood_(from, c, cfg, text, parsed);
}

/** Resultado de la IA (ya validado) → mismo formato que parseOrderText_. */
function aiToParsed_(v, index, units) {
  var byId = {};
  index.list.forEach(function (it) { byId[it.id] = it; });
  var out = { items: [], asks: [], missing: [], notes: [] };
  v.items.forEach(function (it) {
    if (!it.product_id) { out.missing.push({ raw: it.raw_text, options: [] }); return; }
    var p = byId[it.product_id];
    var base = { raw: it.raw_text, qty: it.qty, unit: it.unit, id: p.id, p: p.p, visible: p.visible };
    // La IA puede adivinar mal ("fruta peluda" → pitaya). Si el texto no nombra claramente ese producto, se confirma con el cliente.
    var m = matchProducts_(it.raw_text || '', index);
    var named = m.candidates.some(function (x) { return x.id === p.id && x.score >= NLU_ASK; });
    if (!named) { base.kind = 'product'; base.options = [{ id: p.id, p: p.p }]; out.asks.push(base); return; }
    if (it.qty === null) { base.kind = 'qty'; out.asks.push(base); return; }
    var conv = convertQty_(it.qty, it.unit, p.p.unidad, units);
    if (!conv.ok) { base.kind = 'unit'; out.asks.push(base); return; }
    var step = qtyStep_(p.p.unidad);
    base.cantidad = Math.max(step, Math.round(conv.qty / step) * step);
    out.items.push(base);
  });
  return out;
}

function cartState_(c) {
  var cart = c.data.carrito || [];
  if (!cart.length) return 'sin pedido en curso';
  return 'paso ' + (c.row.paso || 'inicio') + '; carrito: ' + cart.map(function (x) { return x.id + ' x' + x.cantidad; }).join(', ');
}

/** No entendió: primero una ayuda con ejemplos y botones; a la segunda, asesor. */
function misunderstood_(from, c, cfg, text, parsed) {
  c.data.fallos = (c.data.fallos || 0) + 1;
  bumpMetric_('no_entendidos');
  logUnresolved_(from, text, 'no_entendido');
  if (c.data.fallos >= 2) {
    c.data.fallos = 0;
    return startHandoff_(from, c, cfg, 'no_entiendo', 'Creo que no te estoy entendiendo bien 🙈. Te paso con una persona del equipo.', text);
  }
  saveClient_(c);
  var sugg = (parsed && parsed.missing[0] && parsed.missing[0].options) || [];
  if (sugg.length) {
    return waButtons_(from, 'No encontré "' + cut_(text, 40) + '" 🤔. ¿Quizás alguno de estos?', sugg.slice(0, 3).map(function (o) {
      return { id: 'add:' + o.id, title: o.p.nombre };
    }));
  }
  return waButtons_(from, 'No encontré "' + cut_(text, 40) + '" 🤔. Puedes escribirme algo como *2 libras de tomate chonto* o ver los productos:', [
    { id: 'cat', title: '🛒 Ver productos' },
    { id: 'info', title: 'ℹ️ Horario y envíos' },
    { id: 'asesor', title: '🙋 Hablar con asesor' }
  ]);
}

/** Agrega lo entendido al carrito y pregunta lo que falte, una cosa a la vez. */
function addParsed_(from, c, cfg, parsed) {
  c.data.fallos = 0;
  c.data.ultima = 'order';
  var cart = c.data.carrito || [];
  var added = [];
  var tooMuch = [];
  parsed.items = parsed.items.filter(function (it) {
    var max = num_(it.row && it.row.max_cantidad, 0) || num_((productIndex_().list.filter(function (x) { return x.id === it.id; })[0] || { row: {} }).row.max_cantidad, 0) || MAX_QTY;
    if (it.cantidad > max) { tooMuch.push(it.p.nombre + ': máximo ' + qtyStr_(max) + ' ' + unitLabel_(it.p.unidad) + ' por pedido (pediste ' + qtyStr_(it.cantidad) + ')'); return false; }
    return true;
  });
  parsed.items.forEach(function (it) {
    var line = cart.filter(function (x) { return x.id === it.id; })[0];
    if (line) line.cantidad = Math.round((num_(line.cantidad, 0) + it.cantidad) * 100) / 100;
    else cart.push({ id: it.id, cantidad: it.cantidad });
    added.push(it);
  });
  c.data.carrito = cart;
  if (added.length) c.data.version = (c.data.version || 0) + 1;
  if (parsed.notes && parsed.notes.length) c.data.notas = clip_((c.data.notas ? c.data.notas + '. ' : '') + parsed.notes.join('. '), 300);
  var questions = (c.data.preguntas || []).concat(parsed.asks.map(function (a) {
    return { kind: a.kind, raw: a.raw, qty: a.qty, unit: a.unit, id: a.id || '', options: (a.options || []).map(function (o) { return o.id; }), tries: 0 };
  }));
  c.data.preguntas = questions;
  var msg = [];
  if (added.length) {
    msg.push('Anoté ✅ ' + added.map(function (it) { return qtyStr_(it.cantidad) + ' ' + unitLabel_(it.p.unidad) + ' ' + it.p.nombre + (it.approx ? ' (aprox.)' : ''); }).join(', ') + '.');
  }
  if (tooMuch.length) msg.push('⚠️ ' + tooMuch.join('\n') + '\nPara cantidades grandes te ayuda una persona: escribe *asesor*.');
  var missing = parsed.missing.filter(function (m) { return m.raw; });
  if (missing.length) {
    msg.push('No manejamos ' + missing.map(function (m) { return '"' + cut_(m.raw, 30) + '"'; }).join(', ') + ' 😕' +
      (missing[0].options.length ? '. Parecidos: ' + missing[0].options.map(function (o) { return o.p.nombre; }).join(', ') + '.' : '.'));
    missing.forEach(function (m) { logUnresolved_(from, m.raw, 'producto_no_encontrado'); });
  }
  if (questions.length) return askNext_(from, c, cfg, msg.join('\n'));
  if (!cart.length) {
    saveClient_(c);
    return waButtons_(from, (msg.join('\n') || 'No encontré esos productos 🤔.') + '\n\n¿Qué más te anoto?', [
      { id: 'cat', title: '🛒 Ver productos' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]);
  }
  return sendCart_(from, c, cfg, msg.join('\n'));
}

function productById_(id) {
  var row = table_(SHEETS.PRODUCTS).rows.filter(function (p) { return String(p.id).trim() === id; })[0];
  return row ? publicProduct_(row, todayStr_()) : null;
}

/** Hace la primera pregunta pendiente (producto, cantidad o unidad), con botones. */
function askNext_(from, c, cfg, prefix) {
  var q = (c.data.preguntas || [])[0];
  if (!q) return sendCart_(from, c, cfg, prefix);
  c.row.paso = 'pregunta';
  saveClient_(c);
  var pre = prefix ? prefix + '\n\n' : '';
  if (q.kind === 'product') {
    var opts = q.options.map(productById_).filter(Boolean);
    if (opts.length === 1) {
      return waButtons_(from, pre + '¿Te refieres a *' + opts[0].nombre + '* (' + money_(priceOf_(opts[0])) + '/' + unitLabel_(opts[0].unidad) + ')?', [
        { id: 'pp:' + opts[0].id, title: '✅ Sí' }, { id: 'pp:none', title: '❌ No' }]);
    }
    var body = pre + '¿Cuál ' + (q.raw ? 'de estos para "' + cut_(q.raw, 30) + '"' : 'quieres') + '?';
    if (opts.length <= 2) {
      return waButtons_(from, body, opts.map(function (p) { return { id: 'pp:' + p.id, title: p.nombre }; }).concat([{ id: 'pp:none', title: 'Ninguno' }]));
    }
    return waList_(from, body, 'Elegir', opts.slice(0, 9).map(function (p) {
      return { id: 'pp:' + p.id, title: p.nombre, description: money_(priceOf_(p)) + '/' + unitLabel_(p.unidad) + (p.disponible ? '' : ' · agotado') };
    }).concat([{ id: 'pp:none', title: 'Ninguno de estos' }]), 'Productos');
  }
  var p = productById_(q.id);
  if (!p) { c.data.preguntas.shift(); return askNext_(from, c, cfg, prefix); }
  var price = money_(priceOf_(p)) + '/' + unitLabel_(p.unidad);
  if (!p.disponible) {
    c.data.preguntas.shift();
    return askNext_(from, c, cfg, pre + 'Hoy no tenemos *' + p.nombre + '* 😕.');
  }
  var choices = qtyChoices_(p, q);
  var ask = q.kind === 'unit'
    ? '*' + p.nombre + '* se vende por ' + unitName_(p.unidad) + ' (' + price + '). ¿Cuánto quieres?'
    : '¿Cuánto de *' + p.nombre + '* quieres? (' + price + ')';
  return waButtons_(from, pre + ask + '\n\nTambién puedes escribirlo (ej: *media libra*, *2 kilos*).', choices);
}

function priceOf_(p) { return p.oferta !== null && p.oferta !== undefined ? p.oferta : p.precio; }

function unitName_(u) {
  return { kg: 'kilo', lb: 'libra', unidad: 'unidad', atado: 'atado', canasta: 'canasta', paquete: 'paquete', bandeja: 'bandeja' }[u] || u;
}

/** Botones de cantidad en la unidad del producto. */
function qtyChoices_(p, q) {
  var u = p.unidad;
  if (u === 'kg') {
    if (q.kind === 'unit' && q.qty) {
      return [{ id: 'q:' + q.qty, title: qtyStr_(q.qty) + ' kilos' }, { id: 'q:' + q.qty / 2, title: qtyStr_(q.qty) + ' libras' }, { id: 'q:1', title: '1 kilo' }];
    }
    return [{ id: 'q:0.5', title: '1 libra (½ kg)' }, { id: 'q:1', title: '1 kilo' }, { id: 'q:2', title: '2 kilos' }];
  }
  if (u === 'lb') return [{ id: 'q:1', title: '1 libra' }, { id: 'q:2', title: '2 libras' }, { id: 'q:4', title: '4 libras' }];
  var label = unitLabel_(u);
  return [1, 2, 3].map(function (n) { return { id: 'q:' + n, title: n + ' ' + label }; });
}

/** El cliente respondió una pregunta pendiente escribiendo. */
function answerQuestion_(from, c, cfg, text, norm, intent) {
  var q = (c.data.preguntas || [])[0];
  if (!q) { c.row.paso = 'carrito'; return false; }
  if (['greeting', 'hours', 'location', 'delivery_info', 'payment_info', 'thanks', 'catalog', 'offers'].indexOf(intent) >= 0) return false;
  if (q.kind === 'product') {
    var index = productIndex_();
    var n = Number(norm);
    var pick = null;
    if (n >= 1 && n <= q.options.length && n % 1 === 0) pick = q.options[n - 1];
    if (!pick) {
      var m = matchProducts_(text, index);
      var within = m.candidates.filter(function (x) { return q.options.indexOf(x.id) >= 0; });
      if (within.length && (within.length === 1 || within[0].score - within[1].score >= NLU_MARGIN)) pick = within[0].id;
      else if (m.candidates.length && resolveProduct_(m).status === 'ok') {
        // Respondió con otro producto: se toma como nuevo pedido.
        c.data.preguntas.shift();
        return orderOrSearch_(from, c, cfg, text, norm, 'order'), true;
      }
    }
    if (pick) { chooseProduct_(from, c, cfg, pick); return true; }
    if (intent === 'deny') { c.data.preguntas.shift(); askNext_(from, c, cfg, 'Listo, lo dejo por fuera.'); return true; }
    return retryQuestion_(from, c, cfg);
  }
  // Cantidad o unidad
  var units = unitTable_();
  var items = splitItems_(norm, units);
  var it = items.filter(function (x) { return x.qty !== null; })[0];
  var bare = norm.match(/^(\d+(?:\.\d+)?)$/);
  var unitOnly = !it && units[norm] ? units[norm].unit : null;
  var p = productById_(q.id);
  if (!p) { c.data.preguntas.shift(); askNext_(from, c, cfg, ''); return true; }
  var qty = null, unit = null;
  if (it) { qty = it.qty; unit = it.unit; } else if (bare) { qty = Number(bare[1]); } else if (unitOnly && q.qty) { qty = q.qty; unit = unitOnly; }
  if (qty === null) {
    if (intent === 'deny') { c.data.preguntas.shift(); askNext_(from, c, cfg, 'Listo, lo dejo por fuera.'); return true; }
    if (intent === 'order' || intent === 'change') return false;
    return retryQuestion_(from, c, cfg);
  }
  var conv = convertQty_(qty, unit, p.unidad, units);
  if (!conv.ok) return retryQuestion_(from, c, cfg);
  setQuestionQty_(from, c, cfg, p, conv.qty);
  return true;
}

function retryQuestion_(from, c, cfg) {
  var q = c.data.preguntas[0];
  q.tries = (q.tries || 0) + 1;
  if (q.tries >= 2) {
    c.data.preguntas.shift();
    askNext_(from, c, cfg, 'No logré entender esa parte 🙈, la dejo por fuera. Puedes verla en el catálogo o escribir *asesor*.');
    return true;
  }
  askNext_(from, c, cfg, 'Perdón, no te entendí 🙏. Elige una opción:');
  return true;
}

function chooseProduct_(from, c, cfg, id) {
  var q = c.data.preguntas[0];
  var p = productById_(id);
  if (!p) { c.data.preguntas.shift(); return askNext_(from, c, cfg, ''); }
  if (q.qty === null || q.qty === undefined) {
    c.data.preguntas[0] = { kind: 'qty', id: id, raw: q.raw, qty: null, unit: q.unit, options: [], tries: 0 };
    return askNext_(from, c, cfg, '');
  }
  var units = unitTable_();
  var weight = units[p.unidad] && units[p.unidad].grams;
  if (!q.unit && weight && q.qty % 1 === 0) {
    c.data.preguntas[0] = { kind: 'unit', id: id, raw: q.raw, qty: q.qty, unit: null, options: [], tries: 0 };
    return askNext_(from, c, cfg, '');
  }
  var conv = convertQty_(q.qty, q.unit, p.unidad, units);
  if (!conv.ok) {
    c.data.preguntas[0] = { kind: 'unit', id: id, raw: q.raw, qty: q.qty, unit: q.unit, options: [], tries: 0 };
    return askNext_(from, c, cfg, '');
  }
  return setQuestionQty_(from, c, cfg, p, conv.qty);
}

function setQuestionQty_(from, c, cfg, p, qty) {
  var step = qtyStep_(p.unidad);
  var q = Math.max(step, Math.round(qty / step) * step);
  q = Math.round(q * 100) / 100;
  c.data.preguntas.shift();
  var cart = c.data.carrito || [];
  var line = cart.filter(function (x) { return x.id === p.id; })[0];
  if (line && c.data.cambiar) line.cantidad = q;
  else if (line) line.cantidad = Math.round((num_(line.cantidad, 0) + q) * 100) / 100;
  else cart.push({ id: p.id, cantidad: q });
  c.data.carrito = cart;
  c.data.version = (c.data.version || 0) + 1;
  return askNext_(from, c, cfg, 'Anoté ✅ ' + qtyStr_(q) + ' ' + unitLabel_(p.unidad) + ' ' + p.nombre + '.');
}

/** Resumen del carrito con botones Terminar / Agregar / Asesor. */
function sendCart_(from, c, cfg, prefix) {
  var priced = priceItems_(c.data.carrito || []);
  var problems = priced.problems;
  // Lo que ya no se puede pedir sale del carrito, y se explica.
  var bad = {};
  problems.forEach(function (p) { bad[p.id] = true; });
  c.data.carrito = (c.data.carrito || []).filter(function (x) { return !bad[x.id]; });
  c.row.paso = c.data.carrito.length ? 'carrito' : '';
  c.data.preguntas = [];
  saveClient_(c);
  var notes = problemLines_(problems);
  var tooMuch = problems.some(function (p) { return p.motivo === 'cantidad'; });
  if (!priced.lines.length) {
    return waButtons_(from, (prefix ? prefix + '\n\n' : '') + (notes.length ? '⚠️ ' + notes.join('\n') + '\n\n' : '') + 'Tu pedido está vacío. ¿Qué te anoto?', [
      { id: 'cat', title: '🛒 Ver productos' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]);
  }
  var variable = priced.lines.some(function (l) { return isDecimalUnit_(l.unidad); });
  var body = (prefix ? prefix + '\n\n' : '') + '🛒 *Tu pedido*\n' + orderLines_(priced.lines).join('\n') +
    '\n\nSubtotal' + (variable ? ' aprox.' : '') + ': *' + money_(sum_(priced.lines)) + '*' +
    (notes.length ? '\n\n⚠️ ' + notes.join('\n') + (tooMuch ? '\nPara cantidades grandes te ayuda una persona: escribe *asesor*.' : '') : '') +
    '\n\n¿Algo más? Escríbelo, o termina el pedido 👇';
  return waButtons_(from, body, [
    { id: 'fin', title: '✅ Terminar pedido' },
    { id: 'mas', title: '➕ Agregar más' },
    { id: 'asesor', title: '🙋 Hablar con asesor' }
  ]);
}

function finishCart_(from, c, cfg) {
  if (!(c.data.carrito || []).length) { saveClient_(c); return sendMenu_(from, c, cfg); }
  c.row.paso = 'entrega';
  saveClient_(c);
  return askDelivery_(from, c, '¿Cómo quieres recibir tu pedido?');
}

/** Vuelve a mostrar el paso en que quedó el cliente. */
function resumeFlow_(from, c, cfg, prefix) {
  var paso = c.row.paso;
  if (paso === 'pregunta') return askNext_(from, c, cfg, prefix);
  if (paso === 'entrega') return askDelivery_(from, c, (prefix ? prefix + '\n\n' : '') + '¿Cómo quieres recibir tu pedido?');
  if (paso === 'direccion') return waText_(from, (prefix ? prefix + '\n\n' : '') + '📍 Escribe la dirección de entrega: barrio, calle y número, y alguna referencia.');
  if (paso === 'nombre') return waText_(from, (prefix ? prefix + '\n\n' : '') + '🙋 ¿A nombre de quién va el pedido?');
  if (paso === 'pago') return askPayment_(from, c, cfg);
  if (paso === 'confirmar' || paso === 'nota') { c.row.paso = 'confirmar'; saveClient_(c); return sendSummary_(from, c, cfg); }
  return sendCart_(from, c, cfg, prefix);
}

/** "quítame el tomate" */
function cartRemove_(from, c, cfg, norm) {
  var cart = c.data.carrito || [];
  if (!cart.length) { saveClient_(c); return waButtons_(from, 'Todavía no tienes productos en el pedido 🛒.', [{ id: 'cat', title: '🛒 Ver productos' }]); }
  var words = norm.replace(REMOVE_RE, '').trim();
  var index = productIndex_();
  var inCart = { list: index.list.filter(function (it) { return cart.some(function (x) { return x.id === it.id; }); }), vocab: index.vocab };
  var m = matchProducts_(words, inCart);
  var targets = m.candidates.filter(function (x) { return x.score >= NLU_ASK; });
  if (/\b(todo|todos|todo el pedido)\b/.test(words)) targets = inCart.list.map(function (it) { return { id: it.id, p: it.p }; });
  if (!targets.length) return sendCart_(from, c, cfg, 'No veo "' + cut_(words, 30) + '" en tu pedido 🤔.');
  if (targets.length > 1 && targets[0].score - targets[1].score < NLU_MARGIN && !/\b(todo|todos)\b/.test(words)) {
    c.data.preguntas = [];
    saveClient_(c);
    return waButtons_(from, '¿Cuál quito?', targets.slice(0, 3).map(function (t) { return { id: 'rm:' + t.id, title: t.p.nombre }; }));
  }
  var removeIds = /\b(todo|todos)\b/.test(words) ? targets.map(function (t) { return t.id; }) : [targets[0].id];
  c.data.carrito = cart.filter(function (x) { return removeIds.indexOf(x.id) < 0; });
  c.data.version = (c.data.version || 0) + 1;
  return sendCart_(from, c, cfg, 'Quité ' + targets.filter(function (t) { return removeIds.indexOf(t.id) >= 0; }).map(function (t) { return t.p.nombre; }).join(', ') + ' ✅');
}

/** "mejor 3 libras de tomate": cambia la cantidad (o agrega si no estaba). */
function cartChange_(from, c, cfg, norm) {
  var parsed = parseOrderText_(norm.replace(CHANGE_RE, ' ').replace(/^(y )/, ''), null, null);
  if (!parsed.items.length && !parsed.asks.length) return orderOrSearch_(from, c, cfg, norm, norm, 'unknown');
  return applyChange_(from, c, cfg, parsed);
}

function applyChange_(from, c, cfg, parsed) {
  var cart = c.data.carrito || [];
  var changed = [];
  parsed.items.forEach(function (it) {
    var line = cart.filter(function (x) { return x.id === it.id; })[0];
    if (line) { line.cantidad = it.cantidad; changed.push(it); }
  });
  parsed.items = parsed.items.filter(function (it) { return changed.indexOf(it) < 0; });
  c.data.carrito = cart;
  if (changed.length) c.data.version = (c.data.version || 0) + 1;
  if (parsed.items.length || parsed.asks.length) {
    c.data.cambiar = true;
    var r = addParsed_(from, c, cfg, parsed);
    c.data.cambiar = false;
    return r;
  }
  return sendCart_(from, c, cfg, 'Cambié ✅ ' + changed.map(function (it) { return it.p.nombre + ' a ' + qtyStr_(it.cantidad) + ' ' + unitLabel_(it.p.unidad); }).join(', '));
}

/** "¿cuánto vale el kilo de mora?" / "¿hay lulo?" — responde precio y disponibilidad, sin adivinar. */
function priceQuery_(from, c, cfg, norm, availability, index) {
  index = index || productIndex_();
  var parsed = parseOrderText_(norm, index, unitTable_());
  var ids = [];
  parsed.items.forEach(function (it) { ids.push(it.id); });
  parsed.asks.forEach(function (a) { if (a.id) ids.push(a.id); else (a.options || []).forEach(function (o) { ids.push(o.id); }); });
  ids = ids.filter(function (id, i) { return ids.indexOf(id) === i; }).slice(0, 6);
  c.data.ultima = 'price';
  c.data.fallos = 0;
  if (!ids.length) {
    var missing = parsed.missing[0];
    saveClient_(c);
    if (missing && missing.raw) {
      logUnresolved_(from, missing.raw, 'producto_no_encontrado');
      var sugg = missing.options || [];
      return waButtons_(from, 'No manejamos "' + cut_(missing.raw.replace(/^(hay|tienen|cuanto vale|precio)\s*/, ''), 30) + '" 😕.' +
        (sugg.length ? ' Parecidos:' : ' Mira lo que tenemos:'), sugg.length
        ? sugg.slice(0, 3).map(function (o) { return { id: 'add:' + o.id, title: o.p.nombre }; })
        : [{ id: 'cat', title: '🛒 Ver productos' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]);
    }
    return waButtons_(from, '¿De qué producto quieres saber el precio? Escríbeme el nombre (ej: *precio del aguacate*).', [{ id: 'cat', title: '🛒 Ver productos' }]);
  }
  bumpMetric_('sin_ia');
  var prods = ids.map(productById_).filter(Boolean);
  var lines = prods.map(function (p) {
    var price = p.oferta !== null ? '~' + money_(p.precio) + '~ *' + money_(p.oferta) + '*' : '*' + money_(p.precio) + '*';
    return (p.disponible ? '✅ ' : '❌ ') + p.nombre + ': ' + price + '/' + unitLabel_(p.unidad) + (p.disponible ? '' : ' (agotado hoy)');
  });
  var available = prods.filter(function (p) { return p.disponible; });
  var body = (availability && prods.length === 1
    ? (prods[0].disponible ? 'Sí, hay 🙌\n' : 'Hoy no tenemos 😕\n')
    : '') + lines.join('\n');
  if (!available.length && prods.length) {
    // Sugerir de la misma categoría.
    var alt = visibleProducts_().filter(function (p) { return p.categoria === prods[0].categoria; }).slice(0, 3);
    saveClient_(c);
    return waButtons_(from, body + (alt.length ? '\n\nTe puede servir:' : ''), alt.length
      ? alt.map(function (p) { return { id: 'add:' + p.id, title: p.nombre }; })
      : [{ id: 'cat', title: '🛒 Ver productos' }]);
  }
  saveClient_(c);
  if (available.length === 1) {
    return waButtons_(from, body + '\n\n¿Te lo anoto?', [
      { id: 'add:' + available[0].id, title: '🛒 Agregar' },
      { id: 'cat', title: '🧺 Ver más' }
    ].concat((c.data.carrito || []).length ? [{ id: 'seguir', title: '↩️ Seguir pedido' }] : []));
  }
  return waButtons_(from, body + '\n\nEscríbeme cuánto quieres (ej: *1 libra de ' + normalize_(available[0].nombre).split(' ')[0] + '*).', [
    { id: 'cat', title: '🧺 Ver más' }].concat((c.data.carrito || []).length ? [{ id: 'seguir', title: '↩️ Seguir pedido' }] : []));
}

/** "lo de siempre" → el último pedido, re-validado con precios de hoy, para confirmar. */
function repeatLastOrder_(from, c, cfg) {
  var last = table_(SHEETS.ORDERS).rows.filter(function (r) { return samePhone_(r.telefono, from) && r.estado !== 'cancelado'; }).slice(-1)[0];
  if (!last) { saveClient_(c); return waButtons_(from, 'Todavía no tienes pedidos anteriores con nosotros. ¿Hacemos uno?', [{ id: 'cat', title: '🛒 Hacer pedido' }]); }
  var items;
  try { items = JSON.parse(last.items || '[]'); } catch (e) { items = []; }
  c.data.carrito = items.map(function (l) { return { id: l.id, cantidad: l.cantidad }; });
  c.data.version = (c.data.version || 0) + 1;
  c.data.preguntas = [];
  return sendCart_(from, c, cfg, '🔁 Tu último pedido (' + last.nro + ') con los precios de hoy:');
}

// ───────────────────────── Botones ─────────────────────────

function customerReply_(from, c, cfg, id) {
  if (id === 'cat') { saveClient_(c); return sendCategories_(from, cfg); }
  if (id === 'todo') { saveClient_(c); return waCatalog_(from, 'Aquí está todo nuestro catálogo 🧺. Agrega lo que quieras al carrito y envíanoslo.', firstVisibleId_()); }
  if (id.indexOf('cat:') === 0) { saveClient_(c); return sendCategory_(from, id.slice(4)); }
  if (id === 'mis') { saveClient_(c); return sendMyOrders_(from); }
  if (id === 'info') { saveClient_(c); return sendInfo_(from, cfg, c); }
  if (id === 'menu') { if (!(c.data.carrito || []).length) resetClient_(c); else saveClient_(c); return sendMenu_(from, c, cfg); }
  if (id === 'asesor') return startHandoff_(from, c, cfg, 'pedido', '');
  if (id === 'repetir') return repeatLastOrder_(from, c, cfg);
  if (id === 'seguir') { saveClient_(c); return resumeFlow_(from, c, cfg, ''); }
  if (id === 'fin') return finishCart_(from, c, cfg);
  if (id === 'mas') {
    c.row.paso = (c.data.carrito || []).length ? 'carrito' : '';
    saveClient_(c);
    return waButtons_(from, 'Escríbeme lo que quieres agregar (ej: *1 libra de fresa y 2 aguacates*) o mira el catálogo 👇', [{ id: 'cat', title: '🛒 Ver productos' }]);
  }
  if (id.indexOf('add:') === 0) {
    c.data.preguntas = [{ kind: 'qty', id: id.slice(4), raw: '', qty: null, unit: null, options: [], tries: 0 }].concat(c.data.preguntas || []);
    return askNext_(from, c, cfg, '');
  }
  if (id.indexOf('pp:') === 0) {
    if (!(c.data.preguntas || []).length) { saveClient_(c); return sendMenu_(from, c, cfg); }
    if (id === 'pp:none') { c.data.preguntas.shift(); return askNext_(from, c, cfg, 'Listo, lo dejo por fuera. Si buscas otro producto, escríbemelo.'); }
    return chooseProduct_(from, c, cfg, id.slice(3));
  }
  if (id.indexOf('q:') === 0) {
    var q = (c.data.preguntas || [])[0];
    var p = q && productById_(q.id);
    if (!p) { saveClient_(c); return sendMenu_(from, c, cfg); }
    return setQuestionQty_(from, c, cfg, p, num_(id.slice(2), 1));
  }
  if (id.indexOf('rm:') === 0) {
    c.data.carrito = (c.data.carrito || []).filter(function (x) { return x.id !== id.slice(3); });
    c.data.version = (c.data.version || 0) + 1;
    return sendCart_(from, c, cfg, 'Listo, lo quité ✅');
  }
  if (id === 'ent:domicilio' || id === 'ent:recoger') return chooseDelivery_(from, c, cfg, id.slice(4));
  if (id === 'dir:misma') return nextStep_(from, c, cfg);
  if (id === 'dir:otra' || id === 'priv:dir') {
    c.data.solo_direccion = !c.row.paso || id === 'priv:dir';
    c.row.paso = 'direccion';
    saveClient_(c);
    return waText_(from, '📍 Escribe la nueva dirección: barrio, calle y número, y alguna referencia. También puedes enviar tu ubicación.');
  }
  if (id.indexOf('pago:') === 0) {
    var methods = paymentMethods_(cfg);
    c.data.pago = methods[num_(id.slice(5), 0)] || '';
    return nextStep_(from, c, cfg);
  }
  if (id === 'nota') {
    c.row.paso = 'nota';
    saveClient_(c);
    return waText_(from, '📝 Escribe la nota para tu pedido (por ejemplo: "mangos maduros", "timbre dañado, llamar").');
  }
  if (id === 'cancelar') {
    resetClient_(c);
    return waButtons_(from, 'Listo, cancelé ese pedido. Cuando quieras, aquí estoy 😊', [{ id: 'cat', title: '🛒 Hacer pedido' }]);
  }
  if (id === 'ok') return confirmOrder_(from, c, cfg);
  if (id === 'aud:ok') {
    var heard = c.data.audio;
    delete c.data.audio;
    if (!heard) { saveClient_(c); return sendMenu_(from, c, cfg); }
    return handleText_(from, c, cfg, heard, { kind: 'text', text: heard });
  }
  if (id.indexOf('cc:') === 0) return customerCancelConfirm_(from, c, cfg, id.slice(3));
  if (id === 'priv:borrar') { saveClient_(c); return askDeleteData_(from); }
  if (id === 'priv:borrar:ok') {
    var res = deleteCustomerData_(from, 'cliente');
    if (!res.ok) {
      return startHandoff_(from, loadClient_(from), cfg, 'otro', 'Tienes pedidos en curso (' + res.abiertos.join(', ') + '). Cuando terminen borramos tus datos; ya le avisé a una persona del equipo 🙏');
    }
    return waText_(from, '✅ Listo, borramos tus datos. Si nos vuelves a escribir, empezamos de cero.');
  }
  saveClient_(c);
  return sendMenu_(from, c, cfg);
}

// ───────────────────────── Menú e información ─────────────────────────

function sendMenu_(to, c, cfg) {
  var name = c.row.nombre || c.data.perfil || '';
  var state = openState_(cfg.horario, null, cfg.horario_festivos);
  var hasOrders = table_(SHEETS.ORDERS).rows.some(function (r) { return samePhone_(r.telefono, to) && r.estado !== 'cancelado'; });
  var first = !c.data.aviso_datos && isBlank_(c.row.consentimiento);
  var body;
  if (c.data.lang === 'en') {
    body = 'Hi' + (name ? ' ' + String(name).split(' ')[0] : '') + '! 👋 I\'m the automated assistant of *' + (cfg.nombre_tienda || 'Natural Fruver') + '*, a fruit & vegetable shop in Pereira.\n' +
      'You can order here (e.g. "2 kg tomatoes" or use the buttons). Type *agent* to talk to a person.' + (state ? '\n\n' + (state.open ? '🟢 ' : '🔴 ') + state.text : '');
  } else {
    body = '¡Hola' + (name ? ' ' + String(name).split(' ')[0] : '') + '! 👋 Soy el asistente automático de *' + (cfg.nombre_tienda || 'Natural Fruver') + '* 🍓🥬\n' +
      'Puedo tomar tu pedido, darte precios y horarios. Si prefieres hablar con una persona, escribe *asesor*.\n' +
      (state ? '\n' + (state.open ? '🟢 ' : '🔴 ') + state.text + '\n' : '') +
      (cfg.banner ? '\n' + cfg.banner + '\n' : '') +
      '\nEscríbeme lo que necesitas (ej: *2 libras de tomate y un aguacate*) o elige una opción:';
  }
  if (first) {
    body += '\n\n' + consentNotice_(cfg);
    c.data.aviso_datos = true;
    saveClient_(c);
  }
  return waButtons_(to, body, [
    { id: 'cat', title: '🛒 Hacer pedido' },
    hasOrders ? { id: 'repetir', title: '🔁 Repetir pedido' } : { id: 'mis', title: '📦 Mis pedidos' },
    { id: 'info', title: 'ℹ️ Horario y envíos' }
  ]);
}

/** Productos que se muestran en WhatsApp (disponibles y no excluidos del catálogo). */
function visibleProducts_() {
  var today = todayStr_();
  return table_(SHEETS.PRODUCTS).rows.filter(function (p) {
    return !isBlank_(p.id) && !isBlank_(p.nombre) && !truthy_(p.archivado) &&
      (isBlank_(p.en_whatsapp) || truthy_(p.en_whatsapp));
  }).map(function (p) { return publicProduct_(p, today); })
    .filter(function (p) { return p.disponible; })
    .sort(function (a, b) { return (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es'); });
}

function firstVisibleId_() {
  var v = visibleProducts_();
  var featured = v.filter(function (p) { return p.destacado; });
  return (featured[0] || v[0] || {}).id || '';
}

function sendCategories_(to, cfg) {
  var products = visibleProducts_();
  var counts = {};
  products.forEach(function (p) { counts[p.categoria] = (counts[p.categoria] || 0) + 1; });
  var rows = [];
  var offers = products.filter(function (p) { return p.oferta !== null; }).length;
  if (offers) rows.push({ id: 'cat:*ofertas', title: '🏷️ Ofertas', description: offers + ' productos con descuento' });
  table_(SHEETS.CATEGORIES).rows
    .filter(function (c) { return counts[String(c.nombre).trim()]; })
    .sort(function (a, b) { return num_(a.orden, 999) - num_(b.orden, 999); })
    .forEach(function (c) {
      var n = String(c.nombre).trim();
      rows.push({ id: 'cat:' + n, title: ((c.icono ? c.icono + ' ' : '') + n), description: counts[n] + ' productos' });
    });
  rows = rows.slice(0, WA_LIST_ROWS - 1);
  rows.push({ id: 'todo', title: '🧺 Ver todo', description: 'Todo el catálogo' });
  return waList_(to, '¿Qué quieres ver? Elige una categoría 👇\n\nTambién puedes escribirme tu pedido (ej: *1 kilo de papa criolla*).', 'Ver categorías', rows, 'Categorías');
}

function sendCategory_(to, name) {
  var products = visibleProducts_();
  var list = name === '*ofertas'
    ? products.filter(function (p) { return p.oferta !== null; })
    : products.filter(function (p) { return p.categoria === name; });
  if (!list.length) {
    return waButtons_(to, name === '*ofertas' ? 'Hoy no hay ofertas 😕, pero mira el catálogo.' : 'Por ahora no hay productos disponibles en ' + name + '.', [{ id: 'cat', title: '🛒 Ver productos' }]);
  }
  return waProducts_(to, name === '*ofertas' ? 'Ofertas' : name,
    'Toca un producto para ver foto y precio. Agrégalo al carrito 🛒 y cuando termines, envíanos el carrito. También puedes escribirme las cantidades.',
    list.map(function (p) { return p.id; }));
}

function sendInfo_(to, cfg, c) {
  var fee = num_(cfg.domicilio_valor, 0);
  var free = num_(cfg.domicilio_gratis_desde, 0);
  var min = num_(cfg.pedido_minimo, 0);
  var state = openState_(cfg.horario, null, cfg.horario_festivos);
  var lines = [
    '🕒 *Horario*',
    hoursText_(cfg.horario),
    state ? '\n' + (state.open ? '🟢 ' : '🔴 ') + state.text : '',
    isBlank_(cfg.horario_festivos) ? 'Festivos: una persona te confirma el horario.' : 'Festivos: ' + (normalize_(cfg.horario_festivos) === 'cerrado' ? 'cerrado' : cfg.horario_festivos),
    '',
    '📍 *Dirección:* ' + (cfg.direccion_tienda || ''),
    '',
    '🛵 *Domicilio:* ' + (fee ? money_(fee) : 'gratis') + (free ? ' (gratis desde ' + money_(free) + ')' : ''),
    cfg.zonas_domicilio ? String(cfg.zonas_domicilio) : '',
    !isBlank_(cfg.hora_corte_mismo_dia) ? 'Pedidos antes de las ' + cfg.hora_corte_mismo_dia + ' se entregan el mismo día.' : '',
    min ? 'Pedido mínimo: ' + money_(min) : ''
  ];
  var hasCart = c && (c.data.carrito || []).length && c.row.paso;
  return waButtons_(to, lines.filter(function (l, i) { return l !== '' || i === 4 || i === 6; }).join('\n'), hasCart
    ? [{ id: 'seguir', title: '↩️ Seguir pedido' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]
    : [{ id: 'cat', title: '🛒 Hacer pedido' }, { id: 'menu', title: '🏠 Menú' }]);
}

function paymentMethods_(cfg) {
  return String(cfg.metodos_pago || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

function sendPaymentInfo_(to, cfg, c) {
  var methods = paymentMethods_(cfg);
  var hasCart = c && (c.data.carrito || []).length && c.row.paso;
  var body = methods.length
    ? '💳 *Formas de pago:* ' + methods.join(', ') + '.\nLos datos para pagar te los damos al confirmar el pedido.'
    : '💳 Las formas de pago te las confirma una persona del equipo al confirmar tu pedido.';
  return waButtons_(to, body, hasCart
    ? [{ id: 'seguir', title: '↩️ Seguir pedido' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]
    : [{ id: 'cat', title: '🛒 Hacer pedido' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]);
}

function sendMyOrders_(to) {
  var mine = table_(SHEETS.ORDERS).rows.filter(function (r) { return samePhone_(r.telefono, to); }).slice(-5).reverse();
  if (!mine.length) {
    return waButtons_(to, 'Todavía no tienes pedidos con nosotros.', [{ id: 'cat', title: '🛒 Hacer pedido' }]);
  }
  var icons = { pendiente: '🕒', confirmado: '✅', en_preparacion: '🧺', en_camino: '🛵', entregado: '📦', cancelado: '❌' };
  var lines = mine.map(function (r) {
    return (icons[r.estado] || '•') + ' *' + r.nro + '* · ' + (STATE_LABELS[r.estado] || r.estado) + ' · ' + money_(r.total) + '\n   ' + fmtDateTime_(r.fecha);
  });
  return waButtons_(to, 'Tus últimos pedidos:\n\n' + lines.join('\n'), [{ id: 'cat', title: '🛒 Hacer pedido' }, { id: 'menu', title: '🏠 Menú' }]);
}

function lastOpenOrder_(phone) {
  return table_(SHEETS.ORDERS).rows.filter(function (r) {
    return samePhone_(r.telefono, phone) && FINAL_STATES.indexOf(String(r.estado)) < 0 && !isBlank_(r.nro);
  }).slice(-1)[0] || null;
}

function sendStatus_(to, c) {
  var o = lastOpenOrder_(to);
  if (!o) return waButtons_(to, 'No tienes pedidos en curso 🙂.', [{ id: 'mis', title: '📦 Mis pedidos' }, { id: 'cat', title: '🛒 Hacer pedido' }]);
  var text = {
    pendiente: 'lo recibimos y estamos por confirmarlo 🕒',
    confirmado: 'está confirmado ✅',
    en_preparacion: 'lo estamos preparando 🧺',
    en_camino: 'ya va en camino 🛵'
  }[o.estado] || STATE_LABELS[o.estado];
  return waButtons_(to, 'Tu pedido *' + o.nro + '* ' + text + '.', [{ id: 'asesor', title: '🙋 Hablar con asesor' }, { id: 'menu', title: '🏠 Menú' }]);
}

/** El cliente quiere cancelar un pedido ya hecho: si está pendiente, puede; si no, lo ve una persona. */
function customerCancel_(from, c, cfg) {
  if ((c.data.carrito || []).length && c.row.paso) {
    return waButtons_(from, '¿Cancelo el pedido que estás armando?', [{ id: 'cancelar', title: '✅ Sí, cancelar' }, { id: 'seguir', title: '↩️ No, seguir' }]);
  }
  var o = lastOpenOrder_(from);
  if (!o) return waButtons_(from, 'No tienes pedidos en curso para cancelar 🙂.', [{ id: 'menu', title: '🏠 Menú' }]);
  if (o.estado !== 'pendiente') {
    return startHandoff_(from, c, cfg, 'cancelar', 'Tu pedido *' + o.nro + '* ya está ' + STATE_LABELS[o.estado] + '. Una persona del equipo te ayuda a cambiarlo o cancelarlo 🙏' +
      (cfg.politica_cancelacion ? '\n\n' + cfg.politica_cancelacion : ''));
  }
  return waButtons_(from, '¿Cancelo el pedido *' + o.nro + '* (' + money_(o.total) + ')?', [
    { id: 'cc:' + o.nro, title: '✅ Sí, cancelar' }, { id: 'menu', title: '❌ No' }]);
}

function customerCancelConfirm_(from, c, cfg, nro) {
  var o = table_(SHEETS.ORDERS).rows.filter(function (r) { return String(r.nro) === nro && samePhone_(r.telefono, from); })[0];
  saveClient_(c);
  if (!o) return sendMenu_(from, c, cfg);
  if (o.estado !== 'pendiente') return customerCancel_(from, c, cfg);
  setOrderStatus_(nro, 'cancelado', 'cliente');
  alertStaff_('❌ El cliente canceló el pedido ' + nro + ' (' + (o.cliente || '') + ').');
  return waButtons_(from, 'Listo, cancelé el pedido *' + nro + '* ✅.', [{ id: 'cat', title: '🛒 Hacer pedido' }]);
}

// ───────────────────────── Carrito de WhatsApp y cierre ─────────────────────────

/** Llega el carrito de WhatsApp: se revisa precio e inventario con la hoja. */
function receiveCart_(from, c, cfg, items) {
  var priced = priceItems_(items);
  var notes = problemLines_(priced.problems);
  if (!priced.lines.length) {
    saveClient_(c);
    return waButtons_(from, 'Lo siento 😕, ' + (notes.length ? 'esto ya no está disponible:\n' + notes.join('\n') : 'no pude leer tu carrito.') +
      '\n\nMira los productos disponibles y envía el carrito de nuevo.', [{ id: 'cat', title: '🛒 Ver productos' }]);
  }
  c.data = { carrito: priced.lines.map(function (l) { return { id: l.id, cantidad: l.cantidad }; }), perfil: c.data.perfil,
    aviso_datos: c.data.aviso_datos, turnos: c.data.turnos, version: (c.data.version || 0) + 1, lang: c.data.lang };
  c.row.paso = 'entrega';
  saveClient_(c);
  var body = '🛒 *Tu pedido*\n' + orderLines_(priced.lines).join('\n') +
    '\n\nSubtotal: *' + money_(sum_(priced.lines)) + '*' +
    (notes.length ? '\n\n⚠️ No disponible ahora:\n' + notes.join('\n') : '') +
    (priced.lines.some(function (l) { return isDecimalUnit_(l.unidad); }) ? '\n\n_Los productos por kg se cuentan en kilos. Si quieres otra cantidad, escríbela (ej: *media libra de fresa*)._' : '');
  return askDelivery_(from, c, body + '\n\n¿Cómo lo quieres recibir?');
}

function askDelivery_(to, c, body) {
  return waButtons_(to, body, [
    { id: 'ent:domicilio', title: '🛵 Domicilio' },
    { id: 'ent:recoger', title: '🏪 Recoger en tienda' },
    { id: 'cancelar', title: '❌ Cancelar' }
  ]);
}

function chooseDelivery_(from, c, cfg, how) {
  if (!c.data.carrito || !c.data.carrito.length) return sendMenu_(from, c, cfg);
  c.data.entrega = how;
  if (how === 'domicilio') {
    if (c.row.direccion) {
      c.row.paso = 'direccion?';
      saveClient_(c);
      return waButtons_(from, '¿Te lo llevamos a esta dirección?\n\n📍 ' + c.row.direccion, [
        { id: 'dir:misma', title: 'Sí, esa dirección' },
        { id: 'dir:otra', title: 'Otra dirección' }
      ]);
    }
    c.row.paso = 'direccion';
    saveClient_(c);
    return waText_(from, '📍 Escribe la dirección de entrega: barrio, calle y número, y alguna referencia.\nTambién puedes enviar tu ubicación.');
  }
  return nextStep_(from, c, cfg);
}

/** Una dirección de Pereira necesita calle/carrera y número, o barrio/conjunto. Se pide solo lo que falta. */
function captureAddress_(from, c, cfg, text) {
  var addr = clip_((c.data.dir_parcial ? c.data.dir_parcial + ', ' : '') + text, 200);
  var n = normalize_(addr);
  var hasNumber = /\d/.test(n);
  var hasPlace = /\b(barrio|b\/|conjunto|urbanizacion|urb|edificio|torre|apto|apartamento|casa|manzana|mz|finca|vereda|km|kilometro|condominio|sector|villa|la|el|los|las)\b/.test(n) || n.split(' ').length >= 4;
  var blocked = String(cfg.zonas_sin_cobertura || '').split(',').map(normalize_).filter(Boolean)
    .filter(function (z) { return (' ' + n + ' ').indexOf(' ' + z + ' ') >= 0; });
  if (blocked.length) {
    c.data.dir_parcial = '';
    c.data.fallos_dir = 0;
    saveClient_(c);
    return waButtons_(from, 'Por ahora no llegamos a ' + blocked[0] + ' 😕. Puedes recoger en la tienda o preguntarle a una persona del equipo.', [
      { id: 'ent:recoger', title: '🏪 Recoger en tienda' }, { id: 'asesor', title: '🙋 Hablar con asesor' }, { id: 'cancelar', title: '❌ Cancelar' }]);
  }
  if (!hasNumber || !hasPlace || addr.length < 8) {
    c.data.fallos_dir = (c.data.fallos_dir || 0) + 1;
    c.data.dir_parcial = addr;
    if (c.data.fallos_dir >= 3) {
      c.data.fallos_dir = 0;
      return startHandoff_(from, c, cfg, 'direccion', 'No logré entender la dirección 🙈. Una persona del equipo te ayuda a completarla.', addr);
    }
    saveClient_(c);
    if (!hasNumber) return waText_(from, '📍 Me falta la calle o carrera y el número (ej: *Cra 7 # 20-30*). También puedes enviar tu ubicación.');
    return waText_(from, '📍 ¿En qué barrio o conjunto queda? Si tiene torre, apto o casa, escríbelo también.');
  }
  c.data.dir_parcial = '';
  c.data.fallos_dir = 0;
  c.row.direccion = addr;
  if (c.data.solo_direccion) {
    c.data.solo_direccion = false;
    c.row.paso = (c.data.carrito || []).length ? 'carrito' : '';
    saveClient_(c);
    return waButtons_(from, '✅ Dirección guardada:\n📍 ' + addr, [{ id: (c.data.carrito || []).length ? 'seguir' : 'cat', title: (c.data.carrito || []).length ? '↩️ Seguir pedido' : '🛒 Hacer pedido' }]);
  }
  return nextStep_(from, c, cfg);
}

function handleLocation_(from, c, cfg, input) {
  if (c.row.paso === 'direccion' || c.row.paso === 'direccion?' || c.data.entrega === 'domicilio' && !c.row.direccion) {
    var addr = clip_((input.text ? input.text + ' ' : '') + '(ubicación: https://maps.google.com/?q=' + input.lat + ',' + input.lng + ')', 200);
    c.row.direccion = addr;
    c.data.dir_parcial = '';
    if (c.data.solo_direccion) { c.data.solo_direccion = false; c.row.paso = (c.data.carrito || []).length ? 'carrito' : ''; saveClient_(c); return waButtons_(from, '✅ Ubicación guardada 📍', [{ id: 'seguir', title: '↩️ Seguir pedido' }]); }
    // Pedimos una referencia (torre, apto, casa) porque el pin no siempre basta.
    c.data.notas = clip_((c.data.notas ? c.data.notas + '. ' : '') + 'Ubicación enviada por WhatsApp', 300);
    return nextStep_(from, c, cfg);
  }
  c.row.direccion = clip_((input.text ? input.text + ' ' : '') + '(ubicación: https://maps.google.com/?q=' + input.lat + ',' + input.lng + ')', 200);
  saveClient_(c);
  return waButtons_(from, 'Recibí tu ubicación 📍 y la guardé para tus domicilios. ¿Hacemos un pedido?', [{ id: 'cat', title: '🛒 Hacer pedido' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]);
}

function handleAudio_(from, c, cfg, input) {
  var r = transcribeAudio_(cfg, from, input.id);
  if (!r.ok || r.confidence < 0.6) {
    saveClient_(c);
    var why = r.reason === 'largo' ? 'Tu audio es un poco largo para mí 🙈.' : 'No pude escuchar bien el audio 🙏.';
    return waButtons_(from, why + ' ¿Me lo escribes, o te paso con una persona?', [
      { id: 'mas', title: '✍️ Lo escribo' }, { id: 'asesor', title: '🙋 Hablar con asesor' }]);
  }
  // Nunca se actúa sobre un audio sin que el cliente confirme lo que se entendió.
  c.data.audio = clip_(r.text, 500);
  saveClient_(c);
  return waButtons_(from, 'Entendí: "' + cut_(r.text, 300) + '"\n\n¿Es correcto?', [
    { id: 'aud:ok', title: '✅ Sí' }, { id: 'mas', title: '✍️ No, lo escribo' }]);
}

/** Pide lo que falte (dirección, nombre, pago) y luego muestra el resumen. */
function nextStep_(to, c, cfg) {
  cfg = cfg || getConfig_();
  if (c.data.entrega === 'domicilio' && !c.row.direccion) {
    c.row.paso = 'direccion';
    saveClient_(c);
    return waText_(to, '📍 Escribe la dirección de entrega: barrio, calle y número, y alguna referencia.');
  }
  if (!c.row.nombre) {
    c.row.paso = 'nombre';
    saveClient_(c);
    var guess = c.data.perfil ? ' (¿' + c.data.perfil + '?)' : '';
    return waText_(to, '🙋 ¿A nombre de quién va el pedido?' + guess);
  }
  var methods = paymentMethods_(cfg);
  if (methods.length > 1 && !c.data.pago) return askPayment_(to, c, cfg);
  if (methods.length === 1) c.data.pago = methods[0];
  c.row.paso = 'confirmar';
  saveClient_(c);
  return sendSummary_(to, c, cfg);
}

function askPayment_(to, c, cfg) {
  var methods = paymentMethods_(cfg);
  c.row.paso = 'pago';
  saveClient_(c);
  if (methods.length <= 3) {
    return waButtons_(to, '💳 ¿Cómo vas a pagar?', methods.map(function (m, i) { return { id: 'pago:' + i, title: m }; }));
  }
  return waList_(to, '💳 ¿Cómo vas a pagar?', 'Forma de pago', methods.slice(0, 10).map(function (m, i) { return { id: 'pago:' + i, title: m }; }), 'Pago');
}

function sendSummary_(to, c, cfg) {
  cfg = cfg || getConfig_();
  var priced = priceItems_(c.data.carrito || []);
  if (!priced.lines.length) {
    resetClient_(c);
    return waButtons_(to, 'Los productos de tu carrito ya no están disponibles 😕.', [{ id: 'cat', title: '🛒 Ver productos' }]);
  }
  var subtotal = sum_(priced.lines);
  var fee = deliveryFee_(cfg, c.data.entrega, subtotal);
  var state = openState_(cfg.horario, null, cfg.horario_festivos);
  var notes = problemLines_(priced.problems);
  var variable = priced.lines.some(function (l) { return isDecimalUnit_(l.unidad); });
  var body = '🧾 *Revisa tu pedido*\n\n' + orderLines_(priced.lines).join('\n') +
    '\n\nSubtotal: ' + money_(subtotal) +
    (c.data.entrega === 'domicilio' ? '\nDomicilio: ' + (fee ? money_(fee) : 'gratis') : '') +
    '\n*Total' + (variable ? ' aprox.' : '') + ': ' + money_(subtotal + fee) + '*' +
    (variable ? '\n_El valor final puede variar un poco según el peso exacto' + (cfg.politica_peso ? ': ' + cfg.politica_peso : '.') + '_' : '') +
    '\n\n' + (c.data.entrega === 'domicilio' ? '🛵 Domicilio a: ' + c.row.direccion : '🏪 Recoges en la tienda: ' + (cfg.direccion_tienda || '')) +
    '\n🙋 A nombre de: ' + c.row.nombre +
    (c.data.pago ? '\n💳 Pago: ' + c.data.pago : '') +
    (c.data.notas ? '\n📝 Nota: ' + c.data.notas : '') +
    (notes.length ? '\n\n⚠️ Ya no disponible (no se incluye):\n' + notes.join('\n') : '') +
    (state && !state.open ? '\n\n🔴 Estamos cerrados. Lo preparamos cuando abramos (' + state.text.replace('Cerrado · ', '') + ').' : '');
  var min = num_(cfg.pedido_minimo, 0);
  if (min > 0 && subtotal < min) {
    return waButtons_(to, body + '\n\nEl pedido mínimo es ' + money_(min) + '. Agrega más productos 🙏', [
      { id: 'mas', title: '➕ Agregar más' }, { id: 'cancelar', title: '❌ Cancelar' }
    ]);
  }
  return waButtons_(to, body, [
    { id: 'ok', title: '✅ Confirmar' },
    { id: 'nota', title: '📝 Agregar nota' },
    { id: 'cancelar', title: '❌ Cancelar' }
  ]);
}

function confirmOrder_(from, c, cfg) {
  cfg = cfg || getConfig_();
  if (c.row.paso !== 'confirmar' || !c.data.carrito || !c.data.carrito.length) return sendMenu_(from, c, cfg);
  var res;
  var clave = orderKey_(from, c);
  var big = num_(cfg.pedido_grande_desde, 0);
  var subtotalNow = sum_(priceItems_(c.data.carrito).lines);
  var review = big > 0 && subtotalNow >= big;
  try {
    res = createOrder_({
      origen: 'whatsapp',
      clave: clave,
      revisar: review,
      cliente: {
        nombre: c.row.nombre, telefono: from, entrega: c.data.entrega,
        direccion: c.data.entrega === 'domicilio' ? c.row.direccion : '', notas: c.data.notas || '', pago: c.data.pago || ''
      },
      items: c.data.carrito
    });
  } catch (err) {
    if (!err.code) throw err;
    if (err.code === 'sin_stock') {
      var probs = (err.extra && err.extra.problemas) || [];
      var gone = problemLines_(probs);
      c.data.carrito = c.data.carrito.filter(function (it) { return !probs.some(function (p) { return p.id === it.id; }); });
      c.data.version = (c.data.version || 0) + 1;
      saveClient_(c);
      waText_(from, '😕 Mientras confirmabas, esto cambió:\n' + gone.join('\n'));
      return c.data.carrito.length ? sendSummary_(from, c, cfg) : resetClient_(c);
    }
    return waText_(from, err.message);
  }
  if (res.duplicado) { resetClient_(c); return; } // doble toque o reintento: el pedido ya existe y ya se avisó
  var data = c.data;
  var row = { nombre: c.row.nombre, telefono: from, direccion: c.row.direccion };
  resetClient_(c);
  bumpMetric_('pedidos');
  audit_('cliente', from, 'pedido', res.nro + ' ' + money_(res.total));
  var cash = !data.pago || /efectivo|contra ?entrega|datafono/i.test(data.pago);
  var payLine = '';
  if (data.pago && !cash) payLine = cfg.datos_pago ? '\n\n💳 *Para pagar (' + data.pago + '):* ' + cfg.datos_pago + '\nCuando pagues, envía el comprobante y una persona lo verifica.' : '\n\n💳 Una persona te envía los datos para el pago.';
  var body = '✅ *¡Pedido ' + res.nro + ' recibido!*\n\n' + orderLines_(res.lineas).join('\n') +
    '\n\n*Total: ' + money_(res.total) + '*' +
    (review ? '\n\n🔎 Como es un pedido grande, una persona lo revisa y te confirma.' : '\n\nTe escribimos apenas lo confirmemos.') +
    payLine +
    '\n\nPara cambiarlo o cancelarlo, escribe *cancelar pedido*' + (cfg.politica_cancelacion ? ' (' + cfg.politica_cancelacion + ')' : '') + '. ¡Gracias! 💚';
  waText_(from, body, { purpose: 'confirmacion', nro: res.nro });
  var ok = notifyWorkersNewOrder_(res, row, data, review ? '🔎 *Pedido grande, revísalo:* ' : '');
  var t = table_(SHEETS.ORDERS);
  var orderRow = t.rows.filter(function (r) { return r.nro === res.nro; })[0];
  if (orderRow && t.headers.indexOf('aviso') >= 0) setCell_(t, orderRow, 'aviso', ok ? 'enviado' : 'fallido');
  if (normalize_(cfg.modo_bot) === 'autonomo' && !review) {
    try { setOrderStatus_(res.nro, 'confirmado', 'bot'); } catch (e) { console.warn('Autoconfirmar: ' + e); }
  }
}

function orderLines_(lines) {
  return lines.map(function (l) {
    return '• ' + qtyStr_(l.cantidad) + ' ' + unitLabel_(l.unidad) + ' ' + l.nombre + ' — ' + money_(l.total);
  });
}

function problemLines_(problems) {
  return (problems || []).map(function (p) {
    if (p.motivo === 'cantidad') return '• ' + p.nombre + ': máximo ' + qtyStr_(p.disponible) + ' ' + unitLabel_(p.unidad) + ' por pedido (pediste ' + qtyStr_(p.pedido) + ')';
    return '• ' + p.nombre + (p.motivo === 'stock' ? ' (solo quedan ' + qtyStr_(p.disponible) + ')' : p.motivo === 'no_existe' ? ' (ya no está en el catálogo)' : ' (agotado)');
  });
}

function sum_(lines) {
  return lines.reduce(function (s, l) { return s + l.total; }, 0);
}

// ─────────────────────── Avisos ───────────────────────

function workers_() {
  return table_(SHEETS.WORKERS).rows.filter(function (w) {
    return (isBlank_(w.activo) || truthy_(w.activo)) && String(w.whatsapp || '').replace(/\D/g, '').length >= 7;
  });
}

/** Compara teléfonos por los últimos 10 dígitos (con o sin +57). */
function samePhone_(a, b) {
  a = String(a || '').replace(/\D/g, '');
  b = String(b || '').replace(/\D/g, '');
  return a.length >= 7 && b.length >= 7 && a.slice(-10) === b.slice(-10);
}

function workerByPhone_(phone) {
  var w = workers_().filter(function (x) { return samePhone_(x.whatsapp, phone); })[0];
  return w ? String(w.nombre || 'Trabajador').trim() : null;
}

/** Número completo con indicativo para enviar (57 + 10 dígitos si falta). */
function waNumber_(phone) {
  var d = String(phone || '').replace(/\D/g, '');
  return d.length === 10 ? '57' + d : d;
}

/** Avisa a los trabajadores de un pedido nuevo. Devuelve true si le llegó al menos a uno. */
function notifyWorkersNewOrder_(order, clientRow, data, prefix) {
  var cfg = getConfig_();
  var body = (prefix || '') + '🛒 *Nuevo pedido ' + order.nro + '*\n\n' + orderLines_(order.lineas).join('\n') +
    '\n\n*Total: ' + money_(order.total) + '*' +
    '\n🙋 ' + clientRow.nombre + ' · +' + waNumber_(clientRow.telefono) +
    '\n' + (data.entrega === 'domicilio' ? '🛵 ' + clientRow.direccion : '🏪 Recoge en la tienda') +
    (data.pago ? '\n💳 ' + data.pago : '') +
    (data.notas ? '\n📝 ' + data.notas : '');
  var delivered = 0;
  workers_().forEach(function (w) {
    var to = waNumber_(w.whatsapp);
    var res = waButtons_(to, body, [
      { id: 'st:' + order.nro + ':confirmado', title: '✅ Confirmar' },
      { id: 'st:' + order.nro + ':cancelado', title: '❌ Cancelar' }
    ], null, { direct: true, purpose: 'aviso_pedido', nro: order.nro });
    // Si el trabajador no ha escrito al bot en 24 horas, Meta exige una plantilla aprobada.
    if (waNeedsTemplate_(res) && cfg.plantilla_aviso_pedido) {
      res = waTemplate_(to, String(cfg.plantilla_aviso_pedido), [order.nro, clientRow.nombre, money_(order.total)], null, { direct: true, purpose: 'aviso_pedido', nro: order.nro });
    }
    if (res && res.ok) delivered++;
  });
  return delivered > 0;
}

/**
 * Avisa al cliente cuando su pedido cambia de estado.
 * Respeta la "baja" y la ventana de 24 h (fuera de ella usa la plantilla o avisa al trabajador).
 * Devuelve 'enviado' | 'plantilla' | 'baja' | 'fuera_de_ventana' | 'no' | 'fallido'.
 */
function notifyCustomerStatus_(order, estado, who) {
  var to = waNumber_(order.telefono);
  if (to.length < 10 || !secret_('WA_TOKEN') || who === 'cliente') return 'no';
  var msg = {
    confirmado: '✅ Tu pedido *' + order.nro + '* fue confirmado. ' +
      (order.entrega === 'domicilio' ? 'Pronto te lo llevamos 🛵.' : 'Te esperamos en la tienda 🏪.'),
    en_preparacion: '🧺 Estamos preparando tu pedido *' + order.nro + '*.',
    en_camino: '🛵 Tu pedido *' + order.nro + '* salió a domicilio. ¡Ya casi llega!',
    entregado: '📦 Pedido *' + order.nro + '* entregado. ¡Gracias por comprar en Natural Fruver! 💚',
    cancelado: '❌ Tu pedido *' + order.nro + '* fue cancelado. Si es un error, respóndenos aquí.'
  }[estado];
  if (!msg) return 'no';
  var c = loadClient_(to);
  if (!isBlank_(c.row.baja)) return 'baja';
  try {
    if (!inWindow_(c)) {
      var tpl = String(getConfig_().plantilla_estado_pedido || '').trim();
      if (!tpl) return 'fuera_de_ventana';
      return waTemplate_(to, tpl, [order.nro, STATE_LABELS[estado] || estado], null, { purpose: 'estado', nro: order.nro }).ok ? 'plantilla' : 'fallido';
    }
    var res = waText_(to, msg, { purpose: 'estado', nro: order.nro });
    if (waNeedsTemplate_(res)) return 'fuera_de_ventana';
    return res.ok ? 'enviado' : 'fallido';
  } catch (e) {
    console.warn('Aviso al cliente: ' + e);
    return 'fallido';
  }
}

/** Estado de entrega de mensajes (sent/delivered/read/failed) que envía Meta. */
function handleStatus_(st) {
  if (st.status !== 'failed') return;
  bumpMetric_('fallos_envio');
  var raw = CacheService.getScriptCache().get('out_' + st.id);
  if (!raw) return;
  var info = JSON.parse(raw);
  var code = ((st.errors || [])[0] || {}).code || '';
  if (info.purpose === 'aviso_pedido') {
    var t = table_(SHEETS.ORDERS);
    var row = t.rows.filter(function (r) { return r.nro === info.nro; })[0];
    if (row && t.headers.indexOf('aviso') >= 0 && row.aviso !== 'visto') setCell_(t, row, 'aviso', 'fallido');
    return;
  }
  if (info.purpose === 'confirmacion' || info.purpose === 'estado') {
    alertStaff_('⚠️ No le llegó al cliente +' + waNumber_(info.to) + ' el mensaje del pedido ' + info.nro + ' (error ' + code + '). Escríbele desde la app.');
  }
}

// ───────────────────── Trabajadores ─────────────────────

var WORKER_HELP = [
  '🧑‍🌾 *Comandos para trabajadores*',
  '',
  '*pedidos* — pedidos abiertos',
  '*pedido 12* — ver el pedido NF-0012',
  '*confirmar 12* · *preparando 12* · *en camino 12* · *entregado 12* · *cancelar 12*',
  '*deshacer 12* — deshace el último cambio de estado (30 min)',
  '',
  '*ver mango* — buscar un producto',
  '*precio mango 5500*',
  '*oferta mango 5000* · *oferta mango 5000 hasta 15/10* · *oferta mango quitar*',
  '*stock mango 20* · *stock mango +5* · *stock mango no* (dejar de contar)',
  '*agotado fresa* · *disponible fresa*',
  '',
  '*asesor* — clientes esperando una persona',
  '*tomar 3001234567* · *devolver 3001234567* — atender un chat / devolverlo al bot',
  '*responder 3001234567 texto* — escribirle a un cliente por el bot',
  '*bloquear 3001234567* · *desbloquear 3001234567*',
  '*pausar* · *reanudar* — apagar / prender el bot para todos',
  '*hoy* — resumen del día · *sinresolver* — lo que el bot no entendió',
  '',
  '*comprar* — usar el bot como cliente'
].join('\n');

/** Devuelve true si el mensaje era para el modo trabajador. */
function handleWorker_(from, who, input) {
  if (input.kind === 'reply') {
    var id = input.id;
    if (id.indexOf('st:') === 0) {
      var parts = id.split(':');
      workerSetStatus_(from, who, parts[1], parts[2]);
      return true;
    }
    if (id.indexOf('undo:') === 0) { workerUndo_(from, who, id.slice(5)); return true; }
    if (id.indexOf('ho:tomar:') === 0) {
      var tc = takeHandoff_(id.slice(9), who);
      waText_(from, tc ? '🙋 Listo, atiendes a ' + (tc.row.nombre || '+' + waNumber_(id.slice(9))) + '. El bot no le escribe hasta que lo devuelvas (*devolver ' + id.slice(9) + '*) o pasen ' + num_(getConfig_().minutos_devolver_bot, 120) + ' min sin mensajes tuyos.' : 'No encontré ese chat.', { direct: true });
      return true;
    }
    if (id.indexOf('ho:devolver:') === 0) {
      waText_(from, releaseHandoff_(id.slice(12), who, true) ? '🤖 El bot vuelve a atender a +' + waNumber_(id.slice(12)) + '.' : 'Ese chat ya lo atendía el bot.', { direct: true });
      return true;
    }
    if (id.indexOf('dr:') === 0) {
      var p = id.split(':');
      var r = sendDraft_(p[2], p[1] === 'ok');
      waText_(from, { enviado: '✅ Enviado.', descartado: '🗑️ Descartado.', vencido: 'Ese borrador ya no está disponible.', fallido: '⚠️ No se pudo enviar.' }[r], { direct: true });
      return true;
    }
    if (id === 'adm:pausar') { setPaused_(true, who); waText_(from, '⏸️ Bot pausado. Nadie recibe respuestas automáticas. Escribe *reanudar* para prenderlo.', { direct: true }); return true; }
    return false;
  }
  if (input.kind !== 'text') return false;
  var text = input.text.replace(/^\s*\//, '');
  var norm = normalize_(text);
  if (norm === 'comprar' || norm === 'catalogo') return false;
  // Si está haciendo un pedido como cliente, lo que escriba es parte del pedido.
  var paso = loadClient_(from).row.paso;
  if (paso && ['direccion', 'direccion?', 'nombre', 'nota', 'confirmar', 'pregunta', 'pago', 'carrito', 'entrega'].indexOf(paso) >= 0 && !isWorkerCommand_(norm)) return false;

  var m;
  var d = function (t) { return waText_(from, t, { direct: true }); };
  if (!norm || ['ayuda', 'hola', 'menu', 'comandos', 'help'].indexOf(norm) >= 0) {
    d(WORKER_HELP);
  } else if (norm === 'pedidos') {
    workerOrders_(from);
  } else if ((m = norm.match(/^pedido\s+(?:nf\s*)?(\d+)$/))) {
    workerOrderDetail_(from, orderNo_(m[1]));
  } else if ((m = norm.match(/^(confirmar|confirmado|preparando|en preparacion|preparacion|en camino|salio|entregar|entregado|cancelar|cancelado)\s+(?:nf\s*)?(\d+)$/))) {
    var st = { confirmar: 'confirmado', confirmado: 'confirmado', preparando: 'en_preparacion', 'en preparacion': 'en_preparacion', preparacion: 'en_preparacion',
      'en camino': 'en_camino', salio: 'en_camino', entregar: 'entregado', entregado: 'entregado', cancelar: 'cancelado', cancelado: 'cancelado' }[m[1]];
    workerSetStatus_(from, who, orderNo_(m[2]), st);
  } else if ((m = norm.match(/^deshacer\s+(?:nf\s*)?(\d+)$/))) {
    workerUndo_(from, who, orderNo_(m[1]));
  } else if (norm === 'pausar') {
    waButtons_(from, '¿Pausar el bot? Nadie recibirá respuestas automáticas hasta que escribas *reanudar*.', [{ id: 'adm:pausar', title: '⏸️ Sí, pausar' }], null, { direct: true });
  } else if (norm === 'reanudar') {
    setPaused_(false, who);
    d('▶️ Bot activo de nuevo.');
  } else if (norm === 'asesor' || norm === 'chats') {
    var list = handoffList_();
    d(list.length ? '🙋 *Chats con personas*\n' + list.join('\n') : 'No hay clientes esperando una persona 🎉');
  } else if ((m = norm.match(/^tomar\s+(\d{7,15})$/))) {
    var tc = takeHandoff_(m[1], who);
    d(tc ? '🙋 Atiendes a +' + waNumber_(m[1]) + '. El bot no le escribe hasta que lo devuelvas.' : 'No encontré ese chat.');
  } else if ((m = norm.match(/^devolver\s+(\d{7,15})$/))) {
    d(releaseHandoff_(m[1], who, true) ? '🤖 El bot vuelve a atender a +' + waNumber_(m[1]) + '.' : 'Ese chat ya lo atendía el bot.');
  } else if ((m = text.match(/^\s*responder\s+(\+?\d[\d ]{6,16})\s+([\s\S]+)$/i))) {
    var tel = m[1].replace(/\D/g, '');
    takeHandoff_(tel, who);
    var sent = waText_(waNumber_(tel), m[2].trim(), { direct: true });
    d(sent.ok ? '✅ Enviado a +' + waNumber_(tel) + '. El bot no le escribe mientras lo atiendes.' : '⚠️ No se pudo enviar (¿pasaron más de 24 h desde su último mensaje?).');
  } else if ((m = norm.match(/^(bloquear|desbloquear)\s+(\d{7,15})$/))) {
    setBlocked_(m[2], m[1] === 'bloquear' ? 'si' : '', who);
    d(m[1] === 'bloquear' ? '🚫 Bloqueado: el bot no le responde.' : '✅ Desbloqueado.');
  } else if (norm === 'hoy' || norm === 'resumen') {
    d(summaryText_());
  } else if (norm === 'sinresolver' || norm === 'sin resolver') {
    d(unresolvedText_());
  } else if ((m = text.match(/^\s*(ver|buscar)\s+(.+)$/i))) {
    workerShowProducts_(from, m[2]);
  } else if ((m = text.match(/^\s*precio\s+(.+?)\s+\$?\s*([\d.,]+)\s*$/i))) {
    workerEdit_(from, who, m[1], function (p) { return saveProduct_({ id: p.id, precio: m[2] }, who); },
      function (p) { return 'Precio de ' + p.nombre + ': ' + money_(num_(m[2], 0)) + ' / ' + unitLabel_(p.unidad); });
  } else if ((m = text.match(/^\s*oferta\s+(.+?)\s+(quitar|no|ninguna)\s*$/i))) {
    workerEdit_(from, who, m[1], function (p) { return saveProduct_({ id: p.id, precio_oferta: '', oferta_hasta: '' }, who); },
      function (p) { return 'Oferta quitada: ' + p.nombre; });
  } else if ((m = text.match(/^\s*oferta\s+(.+?)\s+\$?\s*([\d.,]+)(?:\s+hasta\s+(\S+))?\s*$/i))) {
    var until = m[3] ? parseDayMonth_(m[3]) : '';
    if (m[3] && !until) { d('No entendí la fecha "' + m[3] + '". Usa día/mes, por ejemplo 15/10.'); return true; }
    workerEdit_(from, who, m[1], function (p) { return saveProduct_({ id: p.id, precio_oferta: m[2], oferta_hasta: until }, who); },
      function (p) { return 'Oferta: ' + p.nombre + ' a ' + money_(num_(m[2], 0)) + (until ? ' hasta ' + until : ''); });
  } else if ((m = text.match(/^\s*stock\s+(.+?)\s+(no|[+-]?\s*[\d.,]+)\s*$/i))) {
    var val = m[2].replace(/\s/g, '');
    workerEdit_(from, who, m[1], function (p, row) {
      var stock = /^no$/i.test(val) ? '' : /^[+-]/.test(val) ? num_(row.stock, 0) + num_(val, 0) : num_(val, 0);
      return quickUpdate_(p.id, { stock: stock }, who);
    }, function (p, row) {
      return isBlank_(row.stock) ? 'Ya no se cuenta el inventario de ' + p.nombre : 'Inventario de ' + p.nombre + ': ' + qtyStr_(row.stock) + ' ' + unitLabel_(p.unidad);
    });
  } else if ((m = text.match(/^\s*(agotado|agotar|disponible|hay)\s+(.+)$/i))) {
    var on = /^(disponible|hay)$/i.test(m[1]);
    workerEdit_(from, who, m[2], function (p) { return quickUpdate_(p.id, { disponible: on }, who); },
      function (p) { return (on ? 'Disponible: ' : 'Agotado: ') + p.nombre; });
  } else {
    d('No entendí 🤔.\n\n' + WORKER_HELP);
  }
  return true;
}

function isWorkerCommand_(norm) {
  return /^(pedidos|ayuda|comandos|asesor|chats|hoy|pausar|reanudar|sinresolver|pedido \d|confirmar \d|preparando \d|en camino \d|entregado \d|cancelar \d|deshacer \d|tomar \d|devolver \d|responder \d|bloquear \d|desbloquear \d|precio |oferta |stock |agotado |disponible |ver |buscar )/.test(norm);
}

function orderNo_(n) {
  var s = String(Number(n));
  while (s.length < 4) s = '0' + s;
  return 'NF-' + s;
}

/** "15/10" o "15/10/2026" o "2026-10-15" → "2026-10-15" */
function parseDayMonth_(s) {
  var m = String(s).match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) return todayStr_().slice(0, 4) + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
  return dateStr_(s);
}

/** Busca el producto, aplica el cambio y responde. Si hay varios parecidos, pregunta. */
function workerEdit_(to, who, query, change, done) {
  var found = findProducts_(query, false);
  if (!found.length) return waText_(to, 'No encontré "' + query + '". Escribe *ver ' + query + '* para buscar.', { direct: true });
  if (found.length > 1) {
    return waText_(to, 'Hay varios productos para "' + query + '". Escribe el nombre más completo:\n' +
      found.slice(0, 8).map(function (p) { return '• ' + p.nombre; }).join('\n'), { direct: true });
  }
  try {
    change(found[0], found[0]._row);
  } catch (err) {
    if (!err.code) throw err;
    return waText_(to, '⚠️ ' + err.message, { direct: true });
  }
  var fresh = table_(SHEETS.PRODUCTS).rows.filter(function (r) { return String(r.id) === found[0].id; })[0];
  audit_(who, '', 'producto', found[0].id);
  return waText_(to, '✅ ' + done(found[0], fresh), { direct: true });
}

function workerShowProducts_(to, query) {
  var found = findProducts_(query, false);
  if (!found.length) return waText_(to, 'No encontré "' + query + '".', { direct: true });
  var lines = found.slice(0, 8).map(function (p) {
    return '*' + p.nombre + '* (' + p.categoria + ')\n' +
      '  ' + money_(p.precio) + ' / ' + unitLabel_(p.unidad) + (p.oferta !== null ? ' → oferta ' + money_(p.oferta) + (p.oferta_hasta ? ' hasta ' + p.oferta_hasta : '') : '') +
      '\n  ' + (p.disponible ? '🟢 disponible' : '🔴 agotado') + (p.stock !== null ? ' · inventario ' + qtyStr_(p.stock) : '');
  });
  return waText_(to, lines.join('\n\n') + (found.length > 8 ? '\n\n…y ' + (found.length - 8) + ' más.' : ''), { direct: true });
}

function workerOrders_(to) {
  var open = table_(SHEETS.ORDERS).rows.filter(function (r) {
    return !isBlank_(r.nro) && FINAL_STATES.indexOf(String(r.estado)) < 0;
  });
  if (!open.length) return waText_(to, 'No hay pedidos abiertos 🎉', { direct: true });
  var icons = { pendiente: '🕒', confirmado: '✅', en_preparacion: '🧺', en_camino: '🛵' };
  var lines = open.slice(-20).map(function (r) {
    return (icons[r.estado] || '•') + ' *' + r.nro + '* · ' + r.cliente + ' · ' + money_(r.total) +
      ' · ' + (r.entrega === 'domicilio' ? '🛵' : '🏪') + (truthy_(r.revisar) ? ' · 🔎 revisar' : '');
  });
  return waText_(to, 'Pedidos abiertos (' + open.length + '):\n\n' + lines.join('\n') + '\n\nEscribe *pedido 12* para ver uno.', { direct: true });
}

function workerOrderDetail_(to, nro) {
  var t = table_(SHEETS.ORDERS);
  var r = t.rows.filter(function (x) { return String(x.nro) === nro; })[0];
  if (!r) return waText_(to, 'No existe el pedido ' + nro + '.', { direct: true });
  if (t.headers.indexOf('aviso') >= 0 && r.aviso !== 'visto') setCell_(t, r, 'aviso', 'visto');
  var items;
  try { items = JSON.parse(r.items || '[]'); } catch (e) { items = []; }
  var body = '*' + r.nro + '* · ' + (STATE_LABELS[r.estado] || r.estado) + '\n' + fmtDateTime_(r.fecha) + '\n\n' + orderLines_(items).join('\n') +
    '\n\n*Total: ' + money_(r.total) + '*' + (num_(r.domicilio, 0) ? ' (domicilio ' + money_(r.domicilio) + ')' : '') +
    '\n🙋 ' + r.cliente + ' · +' + waNumber_(r.telefono) +
    '\n' + (r.entrega === 'domicilio' ? '🛵 ' + r.direccion : '🏪 Recoge en la tienda') +
    (r.pago ? '\n💳 ' + r.pago : '') +
    (r.notas ? '\n📝 ' + r.notas : '');
  if (FINAL_STATES.indexOf(String(r.estado)) >= 0) return waText_(to, body, { direct: true });
  var next = { pendiente: ['confirmado', '✅ Confirmar'], confirmado: ['en_camino', '🛵 En camino'], en_preparacion: ['en_camino', '🛵 En camino'], en_camino: ['entregado', '📦 Entregado'] }[r.estado];
  var buttons = [{ id: 'st:' + nro + ':' + next[0], title: next[1] }, { id: 'st:' + nro + ':cancelado', title: '❌ Cancelar' }];
  return waButtons_(to, body, buttons, null, { direct: true });
}

function workerSetStatus_(to, who, nro, estado) {
  var res;
  try {
    res = setOrderStatus_(nro, estado, who);
  } catch (err) {
    if (!err.code) throw err;
    return waText_(to, '⚠️ ' + err.message, { direct: true });
  }
  var t = table_(SHEETS.ORDERS);
  var row = t.rows.filter(function (r) { return r.nro === nro; })[0];
  if (row && t.headers.indexOf('aviso') >= 0 && row.aviso !== 'visto') setCell_(t, row, 'aviso', 'visto');
  var icons = { confirmado: '✅', en_preparacion: '🧺', en_camino: '🛵', entregado: '📦', cancelado: '❌' };
  var told = {
    enviado: 'Le avisé al cliente.', plantilla: 'Le avisé al cliente con la plantilla.',
    baja: 'El cliente pidió no recibir mensajes: avísale tú si hace falta.',
    fuera_de_ventana: '⚠️ No le pude avisar al cliente (pasaron más de 24 h desde su último mensaje). Escríbele desde la app.',
    fallido: '⚠️ No le pude avisar al cliente. Escríbele desde la app.', no: ''
  }[res && res.aviso] || '';
  var msg = (icons[estado] || '') + ' ' + nro + ' ' + (STATE_LABELS[estado] || estado) + '. ' + told;
  var buttons = [];
  if (estado === 'confirmado') buttons.push({ id: 'st:' + nro + ':en_camino', title: '🛵 En camino' });
  if (estado === 'en_camino' || estado === 'en_preparacion') buttons.push({ id: 'st:' + nro + ':entregado', title: '📦 Entregado' });
  if (estado !== 'cancelado') buttons.push({ id: 'undo:' + nro, title: '↩️ Deshacer' });
  return waButtons_(to, msg, buttons, null, { direct: true });
}

function workerUndo_(to, who, nro) {
  try {
    var r = undoOrderStatus_(nro, who);
    return waText_(to, '↩️ ' + nro + ' volvió a *' + (STATE_LABELS[r.estado] || r.estado) + '*. Al cliente no se le avisó nada.', { direct: true });
  } catch (err) {
    if (!err.code) throw err;
    return waText_(to, '⚠️ ' + err.message, { direct: true });
  }
}

// ───────────────────── Búsqueda ─────────────────────

/**
 * Productos que coinciden con el texto: primero por id o nombre exacto, luego
 * por todas las palabras (en nombre, alias, palabras clave o id). Sin tildes.
 * onlyVisible = solo los que el cliente puede pedir.
 */
function findProducts_(query, onlyVisible) {
  var q = normalize_(query);
  if (!q) return [];
  var today = todayStr_();
  var rows = table_(SHEETS.PRODUCTS).rows.filter(function (p) { return !isBlank_(p.id) && !truthy_(p.archivado); });
  var list = rows.map(function (p) {
    var pub = publicProduct_(p, today);
    pub._row = p;
    pub._text = ' ' + normalize_(pub.nombre + ' ' + pub.palabras + ' ' + (p.alias || '') + ' ' + pub.id) + ' ';
    pub._visible = pub.disponible && (isBlank_(p.en_whatsapp) || truthy_(p.en_whatsapp));
    return pub;
  }).filter(function (p) { return !onlyVisible || p._visible; });

  var exact = list.filter(function (p) { return p.id === q.replace(/ /g, '-') || normalize_(p.nombre) === q; });
  if (exact.length) return exact;
  var words = q.split(' ').filter(function (w) { return w.length > 1 && NLU_STOP.indexOf(w) < 0; }).map(function (w) {
    return w.length > 3 ? w.replace(/(es|s)$/, '') : w; // "mangos" → "mango", "fresas" → "fresa"
  });
  if (!words.length) return [];
  return list.filter(function (p) {
    return words.every(function (w) { return p._text.indexOf(' ' + w) >= 0; });
  });
}
