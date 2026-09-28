/**
 * Bot de WhatsApp.
 *
 * Meta envía cada mensaje al relé de Cloudflare (relay/worker.js), que revisa
 * la firma y lo reenvía aquí como { action: 'wa_webhook', secret, payload }.
 *
 * Clientes:  menú → categorías → productos del catálogo → carrito de WhatsApp
 *            → domicilio o recoger → dirección → nombre → confirmar.
 * Trabajadores (número en la pestaña Trabajadores): comandos como
 *            "pedidos", "confirmar 12", "precio mango 5500", "agotado fresa".
 */

var SESSION_HOURS = 12;
var SEEN_SECONDS = 6 * 3600;
var GREETINGS = ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'menu', 'inicio', 'empezar', 'hi', 'ola'];

function handleWebhook_(body) {
  if (!secret_('RELAY_SECRET') || String(body.secret || '') !== secret_('RELAY_SECRET')) {
    throw userError_('permiso', 'No autorizado.');
  }
  var handled = 0;
  var payload = body.payload || {};
  (payload.entry || []).forEach(function (entry) {
    (entry.changes || []).forEach(function (change) {
      var value = change.value || {};
      var names = {};
      (value.contacts || []).forEach(function (c) { names[c.wa_id] = c.profile && c.profile.name; });
      (value.messages || []).forEach(function (msg) {
        if (alreadySeen_(msg.id)) return;
        handled++;
        try {
          handleMessage_(msg, names[msg.from] || '');
        } catch (err) {
          console.error(err && err.stack || err);
          waText_(msg.from, 'Uy, algo falló de nuestro lado 😕. Intenta de nuevo en un momento.');
        }
      });
    });
  });
  return { ok: true, mensajes: handled };
}

/** Meta a veces reenvía el mismo mensaje: se atiende una sola vez. */
function alreadySeen_(id) {
  if (!id) return false;
  var cache = CacheService.getScriptCache();
  if (cache.get('wa_' + id)) return true;
  cache.put('wa_' + id, '1', SEEN_SECONDS);
  return false;
}

/** Mensaje de Meta → { kind: 'text'|'reply'|'order'|'location'|'other', ... } */
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
  handleCustomer_(from, input, profileName);
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
    data = {};
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
  c.data = {};
  saveClient_(c);
}

function handleCustomer_(from, input, profileName) {
  var c = loadClient_(from);
  var cfg = getConfig_();
  if (!c.row.nombre && profileName) c.data.perfil = clip_(profileName, 80);
  var text = input.kind === 'text' ? input.text : '';
  var norm = normalize_(text);

  // Salidas que funcionan en cualquier paso.
  if (input.kind === 'text' && (norm === 'cancelar' || norm === 'salir')) {
    var had = !!c.row.paso;
    resetClient_(c);
    waText_(from, had ? 'Listo, cancelé ese pedido. Escribe *hola* cuando quieras volver a empezar.' : 'No tienes ningún pedido en curso. Escribe *hola* para ver el menú.');
    return;
  }
  if (input.kind === 'order') return receiveCart_(from, c, cfg, input.items);

  if (input.kind === 'reply') return customerReply_(from, c, cfg, input.id);

  // Pasos que esperan un dato escrito.
  if (c.row.paso === 'direccion?' && input.kind === 'text' && /^(si|sí|esa|misma|ok)$/.test(norm)) return nextStep_(from, c, cfg);
  if ((c.row.paso === 'direccion' || c.row.paso === 'direccion?') && (input.kind === 'text' || input.kind === 'location') &&
      GREETINGS.indexOf(norm) < 0) {
    var addr = clip_(input.text || (input.lat + ', ' + input.lng), 200);
    if (input.kind === 'location' && input.lat) addr = clip_((input.text ? input.text + ' ' : '') + '(ubicación: https://maps.google.com/?q=' + input.lat + ',' + input.lng + ')', 200);
    if (addr.length < 5) return waText_(from, 'Escribe la dirección completa: barrio, calle y número, y alguna referencia. También puedes enviar tu ubicación 📍.');
    c.row.direccion = addr;
    return nextStep_(from, c, cfg);
  }
  if (c.row.paso === 'nombre' && input.kind === 'text') {
    if (text.length < 2) return waText_(from, '¿A nombre de quién va el pedido?');
    c.row.nombre = clip_(text, 80);
    return nextStep_(from, c, cfg);
  }
  if ((c.row.paso === 'nota' || c.row.paso === 'confirmar') && input.kind === 'text' && GREETINGS.indexOf(norm) < 0) {
    c.data.notas = clip_((c.data.notas ? c.data.notas + '. ' : '') + text, 300);
    c.row.paso = 'confirmar';
    saveClient_(c);
    return sendSummary_(from, c, cfg);
  }
  if (c.row.paso === 'entrega' && input.kind === 'text' && GREETINGS.indexOf(norm) < 0) {
    return askDelivery_(from, c, 'Elige una opción con los botones 👇');
  }

  if (['comprar', 'catalogo', 'productos', 'pedir', 'hacer pedido'].indexOf(norm) >= 0) {
    if (c.row.paso) resetClient_(c); else saveClient_(c);
    return sendCategories_(from, cfg);
  }
  if (norm === 'mis pedidos' || norm === 'mi pedido') { saveClient_(c); return sendMyOrders_(from); }
  if (norm === 'horario' || norm === 'domicilio' || norm === 'direccion') { saveClient_(c); return sendInfo_(from, cfg); }

  if (input.kind !== 'text' || !norm || GREETINGS.indexOf(norm) >= 0) {
    if (c.row.paso) resetClient_(c); else saveClient_(c);
    return sendMenu_(from, c, cfg);
  }

  // Texto libre: buscar productos ("mango", "queso campesino").
  var found = findProducts_(text, true);
  if (found.length) {
    saveClient_(c);
    waProducts_(from, 'Resultados', 'Encontré ' + found.length + (found.length === 1 ? ' producto' : ' productos') +
      ' para "' + cut_(text, 40) + '". Agrégalos al carrito 🛒 y envíanos el carrito.', found.slice(0, 60).map(function (p) { return p.id; }));
    return;
  }
  saveClient_(c);
  waButtons_(from, 'No encontré "' + cut_(text, 40) + '" 🤔. Mira las categorías o escribe otro producto.', [
    { id: 'cat', title: '🛒 Ver productos' },
    { id: 'info', title: 'ℹ️ Horario y envíos' }
  ]);
}

function customerReply_(from, c, cfg, id) {
  if (id === 'cat') { saveClient_(c); return sendCategories_(from, cfg); }
  if (id === 'todo') { saveClient_(c); return waCatalog_(from, 'Aquí está todo nuestro catálogo 🧺. Agrega lo que quieras al carrito y envíanoslo.', firstVisibleId_()); }
  if (id.indexOf('cat:') === 0) { saveClient_(c); return sendCategory_(from, id.slice(4)); }
  if (id === 'mis') { saveClient_(c); return sendMyOrders_(from); }
  if (id === 'info') { saveClient_(c); return sendInfo_(from, cfg); }
  if (id === 'menu') { resetClient_(c); return sendMenu_(from, c, cfg); }

  if (id === 'ent:domicilio' || id === 'ent:recoger') {
    if (!c.data.carrito || !c.data.carrito.length) return sendMenu_(from, c, cfg);
    c.data.entrega = id.slice(4);
    if (c.data.entrega === 'domicilio') {
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
  if (id === 'dir:misma') return nextStep_(from, c, cfg);
  if (id === 'dir:otra') {
    c.row.paso = 'direccion';
    saveClient_(c);
    return waText_(from, '📍 Escribe la nueva dirección: barrio, calle y número, y alguna referencia.');
  }
  if (id === 'nota') {
    c.row.paso = 'nota';
    saveClient_(c);
    return waText_(from, '📝 Escribe la nota para tu pedido (por ejemplo: "mangos maduros", "timbre dañado, llamar").');
  }
  if (id === 'cancelar') {
    resetClient_(c);
    return waText_(from, 'Listo, cancelé ese pedido. Escribe *hola* cuando quieras.');
  }
  if (id === 'ok') return confirmOrder_(from, c, cfg);

  return sendMenu_(from, c, cfg);
}

function sendMenu_(to, c, cfg) {
  var name = c.row.nombre || c.data.perfil || '';
  var state = openState_(cfg.horario);
  var body = '¡Hola' + (name ? ' ' + String(name).split(' ')[0] : '') + '! 👋 Bienvenido a *' + (cfg.nombre_tienda || 'Natural Fruver') + '* 🍓🥬\n' +
    (state ? '\n' + (state.open ? '🟢 ' : '🔴 ') + state.text + '\n' : '') +
    (cfg.banner ? '\n' + cfg.banner + '\n' : '') +
    '\nPuedes escribir lo que buscas (ej: *mango*) o elegir una opción:';
  return waButtons_(to, body, [
    { id: 'cat', title: '🛒 Hacer pedido' },
    { id: 'mis', title: '📦 Mis pedidos' },
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
  return waList_(to, '¿Qué quieres ver? Elige una categoría 👇\n\nTambién puedes escribir el producto que buscas.', 'Ver categorías', rows, 'Categorías');
}

function sendCategory_(to, name) {
  var products = visibleProducts_();
  var list = name === '*ofertas'
    ? products.filter(function (p) { return p.oferta !== null; })
    : products.filter(function (p) { return p.categoria === name; });
  if (!list.length) return waText_(to, 'Por ahora no hay productos disponibles en ' + name + '. Escribe *hola* para ver el menú.');
  return waProducts_(to, name === '*ofertas' ? 'Ofertas' : name,
    'Toca un producto para ver foto y precio. Agrégalo al carrito 🛒 y cuando termines, envíanos el carrito.',
    list.map(function (p) { return p.id; }));
}

function sendInfo_(to, cfg) {
  var fee = num_(cfg.domicilio_valor, 0);
  var free = num_(cfg.domicilio_gratis_desde, 0);
  var min = num_(cfg.pedido_minimo, 0);
  var state = openState_(cfg.horario);
  var lines = [
    '🕒 *Horario*',
    hoursText_(cfg.horario),
    state ? '\n' + (state.open ? '🟢 ' : '🔴 ') + state.text : '',
    '',
    '📍 *Dirección:* ' + (cfg.direccion_tienda || ''),
    '',
    '🛵 *Domicilio:* ' + (fee ? money_(fee) : 'gratis') + (free ? ' (gratis desde ' + money_(free) + ')' : ''),
    cfg.zonas_domicilio ? String(cfg.zonas_domicilio) : '',
    min ? 'Pedido mínimo: ' + money_(min) : ''
  ];
  return waButtons_(to, lines.filter(function (l, i) { return l !== '' || i === 3 || i === 5; }).join('\n'), [
    { id: 'cat', title: '🛒 Hacer pedido' },
    { id: 'menu', title: '🏠 Menú' }
  ]);
}

function sendMyOrders_(to) {
  var mine = table_(SHEETS.ORDERS).rows.filter(function (r) { return samePhone_(r.telefono, to); }).slice(-5).reverse();
  if (!mine.length) {
    return waButtons_(to, 'Todavía no tienes pedidos con nosotros.', [{ id: 'cat', title: '🛒 Hacer pedido' }]);
  }
  var icons = { pendiente: '🕒', confirmado: '✅', entregado: '📦', cancelado: '❌' };
  var lines = mine.map(function (r) {
    return (icons[r.estado] || '•') + ' *' + r.nro + '* · ' + r.estado + ' · ' + money_(r.total) + '\n   ' + fmtDateTime_(r.fecha);
  });
  return waButtons_(to, 'Tus últimos pedidos:\n\n' + lines.join('\n'), [{ id: 'cat', title: '🛒 Hacer pedido' }, { id: 'menu', title: '🏠 Menú' }]);
}

/** Llega el carrito de WhatsApp: se revisa precio e inventario con la hoja. */
function receiveCart_(from, c, cfg, items) {
  var priced = priceItems_(items);
  var notes = problemLines_(priced.problems);
  if (!priced.lines.length) {
    saveClient_(c);
    return waButtons_(from, 'Lo siento 😕, ' + (notes.length ? 'esto ya no está disponible:\n' + notes.join('\n') : 'no pude leer tu carrito.') +
      '\n\nMira los productos disponibles y envía el carrito de nuevo.', [{ id: 'cat', title: '🛒 Ver productos' }]);
  }
  c.data = { carrito: priced.lines.map(function (l) { return { id: l.id, cantidad: l.cantidad }; }), perfil: c.data.perfil };
  c.row.paso = 'entrega';
  saveClient_(c);
  var body = '🛒 *Tu pedido*\n' + orderLines_(priced.lines).join('\n') +
    '\n\nSubtotal: *' + money_(sum_(priced.lines)) + '*' +
    (notes.length ? '\n\n⚠️ No disponible ahora:\n' + notes.join('\n') : '') +
    (priced.lines.some(function (l) { return isDecimalUnit_(l.unidad); }) ? '\n\n_Los productos por kg se cuentan en kilos. Si quieres otra cantidad, agrégala en una nota._' : '');
  return askDelivery_(from, c, body + '\n\n¿Cómo lo quieres recibir?');
}

function askDelivery_(to, c, body) {
  return waButtons_(to, body, [
    { id: 'ent:domicilio', title: '🛵 Domicilio' },
    { id: 'ent:recoger', title: '🏪 Recoger en tienda' },
    { id: 'cancelar', title: '❌ Cancelar' }
  ]);
}

/** Pide lo que falte (dirección, nombre) y luego muestra el resumen. */
function nextStep_(to, c, cfg) {
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
  c.row.paso = 'confirmar';
  saveClient_(c);
  return sendSummary_(to, c, cfg);
}

function sendSummary_(to, c, cfg) {
  var priced = priceItems_(c.data.carrito || []);
  if (!priced.lines.length) {
    resetClient_(c);
    return waButtons_(to, 'Los productos de tu carrito ya no están disponibles 😕.', [{ id: 'cat', title: '🛒 Ver productos' }]);
  }
  var subtotal = sum_(priced.lines);
  var fee = deliveryFee_(cfg, c.data.entrega, subtotal);
  var state = openState_(cfg.horario);
  var notes = problemLines_(priced.problems);
  var body = '🧾 *Revisa tu pedido*\n\n' + orderLines_(priced.lines).join('\n') +
    '\n\nSubtotal: ' + money_(subtotal) +
    (c.data.entrega === 'domicilio' ? '\nDomicilio: ' + (fee ? money_(fee) : 'gratis') : '') +
    '\n*Total: ' + money_(subtotal + fee) + '*' +
    '\n\n' + (c.data.entrega === 'domicilio' ? '🛵 Domicilio a: ' + c.row.direccion : '🏪 Recoges en la tienda: ' + (cfg.direccion_tienda || '')) +
    '\n🙋 A nombre de: ' + c.row.nombre +
    (c.data.notas ? '\n📝 Nota: ' + c.data.notas : '') +
    (notes.length ? '\n\n⚠️ Ya no disponible (no se incluye):\n' + notes.join('\n') : '') +
    (state && !state.open ? '\n\n🔴 Estamos cerrados. Lo preparamos cuando abramos (' + state.text.replace('Cerrado · ', '') + ').' : '');
  var min = num_(cfg.pedido_minimo, 0);
  if (min > 0 && subtotal < min) {
    return waButtons_(to, body + '\n\nEl pedido mínimo es ' + money_(min) + '. Agrega más productos y envía el carrito de nuevo.', [
      { id: 'cat', title: '🛒 Ver productos' }, { id: 'cancelar', title: '❌ Cancelar' }
    ]);
  }
  return waButtons_(to, body, [
    { id: 'ok', title: '✅ Confirmar' },
    { id: 'nota', title: '📝 Agregar nota' },
    { id: 'cancelar', title: '❌ Cancelar' }
  ]);
}

function confirmOrder_(from, c, cfg) {
  if (c.row.paso !== 'confirmar' || !c.data.carrito || !c.data.carrito.length) return sendMenu_(from, c, cfg);
  var res;
  try {
    res = createOrder_({
      origen: 'whatsapp',
      cliente: {
        nombre: c.row.nombre, telefono: from, entrega: c.data.entrega,
        direccion: c.data.entrega === 'domicilio' ? c.row.direccion : '', notas: c.data.notas || ''
      },
      items: c.data.carrito
    });
  } catch (err) {
    if (!err.code) throw err;
    if (err.code === 'sin_stock') {
      var gone = problemLines_((err.extra && err.extra.problemas) || []);
      c.data.carrito = c.data.carrito.filter(function (it) {
        return !((err.extra && err.extra.problemas) || []).some(function (p) { return p.id === it.id; });
      });
      saveClient_(c);
      waText_(from, '😕 Mientras confirmabas, esto se agotó:\n' + gone.join('\n'));
      return c.data.carrito.length ? sendSummary_(from, c, cfg) : resetClient_(c);
    }
    return waText_(from, err.message);
  }
  var data = c.data;
  resetClient_(c);
  var body = '✅ *¡Pedido ' + res.nro + ' recibido!*\n\n' + orderLines_(res.lineas).join('\n') +
    '\n\n*Total: ' + money_(res.total) + '*' +
    '\n\nTe escribimos apenas lo confirmemos. Si necesitas algo, responde aquí mismo. ¡Gracias! 💚';
  waText_(from, body);
  notifyWorkersNewOrder_(res, c.row, data);
}

function orderLines_(lines) {
  return lines.map(function (l) {
    return '• ' + qtyStr_(l.cantidad) + ' ' + unitLabel_(l.unidad) + ' ' + l.nombre + ' — ' + money_(l.total);
  });
}

function problemLines_(problems) {
  return (problems || []).map(function (p) {
    return '• ' + p.nombre + (p.motivo === 'stock' ? ' (solo quedan ' + qtyStr_(p.disponible) + ')' : ' (agotado)');
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

function notifyWorkersNewOrder_(order, clientRow, data) {
  var cfg = getConfig_();
  var body = '🛒 *Nuevo pedido ' + order.nro + '*\n\n' + orderLines_(order.lineas).join('\n') +
    '\n\n*Total: ' + money_(order.total) + '*' +
    '\n🙋 ' + clientRow.nombre + ' · +' + waNumber_(clientRow.telefono) +
    '\n' + (data.entrega === 'domicilio' ? '🛵 ' + clientRow.direccion : '🏪 Recoge en la tienda') +
    (data.notas ? '\n📝 ' + data.notas : '');
  workers_().forEach(function (w) {
    var to = waNumber_(w.whatsapp);
    var res = waButtons_(to, body, [
      { id: 'st:' + order.nro + ':confirmado', title: '✅ Confirmar' },
      { id: 'st:' + order.nro + ':cancelado', title: '❌ Cancelar' }
    ]);
    // Si el trabajador no ha escrito al bot en 24 horas, Meta exige una plantilla aprobada.
    if (waNeedsTemplate_(res) && cfg.plantilla_aviso_pedido) {
      waTemplate_(to, String(cfg.plantilla_aviso_pedido), [order.nro, clientRow.nombre, money_(order.total)]);
    }
  });
}

/** Avisa al cliente cuando su pedido cambia de estado. */
function notifyCustomerStatus_(order, estado) {
  var to = waNumber_(order.telefono);
  if (to.length < 10 || !secret_('WA_TOKEN')) return;
  var msg = {
    confirmado: '✅ Tu pedido *' + order.nro + '* fue confirmado. ' +
      (order.entrega === 'domicilio' ? 'Pronto te lo llevamos 🛵.' : 'Te esperamos en la tienda 🏪.'),
    entregado: '📦 Pedido *' + order.nro + '* entregado. ¡Gracias por comprar en Natural Fruver! 💚',
    cancelado: '❌ Tu pedido *' + order.nro + '* fue cancelado. Si es un error, respóndenos aquí.'
  }[estado];
  if (msg) {
    try { waText_(to, msg); } catch (e) { console.warn('Aviso al cliente: ' + e); }
  }
}

// ───────────────────── Trabajadores ─────────────────────

var WORKER_HELP = [
  '🧑‍🌾 *Comandos para trabajadores*',
  '',
  '*pedidos* — pedidos abiertos',
  '*pedido 12* — ver el pedido NF-0012',
  '*confirmar 12* · *entregado 12* · *cancelar 12*',
  '',
  '*ver mango* — buscar un producto',
  '*precio mango 5500*',
  '*oferta mango 5000* · *oferta mango 5000 hasta 15/10* · *oferta mango quitar*',
  '*stock mango 20* · *stock mango +5* · *stock mango no* (dejar de contar)',
  '*agotado fresa* · *disponible fresa*',
  '',
  '*comprar* — usar el bot como cliente'
].join('\n');

/** Devuelve true si el mensaje era para el modo trabajador. */
function handleWorker_(from, who, input) {
  if (input.kind === 'reply' && input.id.indexOf('st:') === 0) {
    var parts = input.id.split(':');
    workerSetStatus_(from, who, parts[1], parts[2]);
    return true;
  }
  if (input.kind !== 'text') return false;
  var text = input.text;
  var norm = normalize_(text);
  if (norm === 'comprar' || norm === 'catalogo') return false;
  // Si está haciendo un pedido como cliente, lo que escriba es parte del pedido.
  var paso = loadClient_(from).row.paso;
  if (paso && ['direccion', 'nombre', 'nota', 'confirmar'].indexOf(paso) >= 0 && !isWorkerCommand_(norm)) return false;

  var m;
  if (!norm || ['ayuda', 'hola', 'menu', 'comandos', 'help'].indexOf(norm) >= 0) {
    waText_(from, WORKER_HELP);
  } else if (norm === 'pedidos') {
    workerOrders_(from);
  } else if ((m = norm.match(/^pedido\s+(?:nf\s*)?(\d+)$/))) {
    workerOrderDetail_(from, orderNo_(m[1]));
  } else if ((m = norm.match(/^(confirmar|confirmado|entregar|entregado|cancelar|cancelado)\s+(?:nf\s*)?(\d+)$/))) {
    var st = { confirmar: 'confirmado', confirmado: 'confirmado', entregar: 'entregado', entregado: 'entregado', cancelar: 'cancelado', cancelado: 'cancelado' }[m[1]];
    workerSetStatus_(from, who, orderNo_(m[2]), st);
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
    if (m[3] && !until) { waText_(from, 'No entendí la fecha "' + m[3] + '". Usa día/mes, por ejemplo 15/10.'); return true; }
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
    waText_(from, 'No entendí 🤔.\n\n' + WORKER_HELP);
  }
  return true;
}

function isWorkerCommand_(norm) {
  return /^(pedidos|ayuda|comandos|pedido \d|confirmar \d|entregado \d|cancelar \d|precio |oferta |stock |agotado |disponible |ver |buscar )/.test(norm);
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
  if (!found.length) return waText_(to, 'No encontré "' + query + '". Escribe *ver ' + query + '* para buscar.');
  if (found.length > 1) {
    return waText_(to, 'Hay varios productos para "' + query + '". Escribe el nombre más completo:\n' +
      found.slice(0, 8).map(function (p) { return '• ' + p.nombre; }).join('\n'));
  }
  try {
    change(found[0], found[0]._row);
  } catch (err) {
    if (!err.code) throw err;
    return waText_(to, '⚠️ ' + err.message);
  }
  var fresh = table_(SHEETS.PRODUCTS).rows.filter(function (r) { return String(r.id) === found[0].id; })[0];
  return waText_(to, '✅ ' + done(found[0], fresh));
}

function workerShowProducts_(to, query) {
  var found = findProducts_(query, false);
  if (!found.length) return waText_(to, 'No encontré "' + query + '".');
  var lines = found.slice(0, 8).map(function (p) {
    return '*' + p.nombre + '* (' + p.categoria + ')\n' +
      '  ' + money_(p.precio) + ' / ' + unitLabel_(p.unidad) + (p.oferta !== null ? ' → oferta ' + money_(p.oferta) + (p.oferta_hasta ? ' hasta ' + p.oferta_hasta : '') : '') +
      '\n  ' + (p.disponible ? '🟢 disponible' : '🔴 agotado') + (p.stock !== null ? ' · inventario ' + qtyStr_(p.stock) : '');
  });
  return waText_(to, lines.join('\n\n') + (found.length > 8 ? '\n\n…y ' + (found.length - 8) + ' más.' : ''));
}

function workerOrders_(to) {
  var open = table_(SHEETS.ORDERS).rows.filter(function (r) {
    return !isBlank_(r.nro) && FINAL_STATES.indexOf(String(r.estado)) < 0;
  });
  if (!open.length) return waText_(to, 'No hay pedidos abiertos 🎉');
  var lines = open.slice(-20).map(function (r) {
    return (r.estado === 'pendiente' ? '🕒' : '✅') + ' *' + r.nro + '* · ' + r.cliente + ' · ' + money_(r.total) +
      ' · ' + (r.entrega === 'domicilio' ? '🛵' : '🏪');
  });
  return waText_(to, 'Pedidos abiertos (' + open.length + '):\n\n' + lines.join('\n') + '\n\nEscribe *pedido 12* para ver uno.');
}

function workerOrderDetail_(to, nro) {
  var r = table_(SHEETS.ORDERS).rows.filter(function (x) { return String(x.nro) === nro; })[0];
  if (!r) return waText_(to, 'No existe el pedido ' + nro + '.');
  var items;
  try { items = JSON.parse(r.items || '[]'); } catch (e) { items = []; }
  var body = '*' + r.nro + '* · ' + r.estado + '\n' + fmtDateTime_(r.fecha) + '\n\n' + orderLines_(items).join('\n') +
    '\n\n*Total: ' + money_(r.total) + '*' + (num_(r.domicilio, 0) ? ' (domicilio ' + money_(r.domicilio) + ')' : '') +
    '\n🙋 ' + r.cliente + ' · +' + waNumber_(r.telefono) +
    '\n' + (r.entrega === 'domicilio' ? '🛵 ' + r.direccion : '🏪 Recoge en la tienda') +
    (r.notas ? '\n📝 ' + r.notas : '');
  if (FINAL_STATES.indexOf(String(r.estado)) >= 0) return waText_(to, body);
  var buttons = r.estado === 'pendiente'
    ? [{ id: 'st:' + nro + ':confirmado', title: '✅ Confirmar' }, { id: 'st:' + nro + ':cancelado', title: '❌ Cancelar' }]
    : [{ id: 'st:' + nro + ':entregado', title: '📦 Entregado' }, { id: 'st:' + nro + ':cancelado', title: '❌ Cancelar' }];
  return waButtons_(to, body, buttons);
}

function workerSetStatus_(to, who, nro, estado) {
  try {
    setOrderStatus_(nro, estado, who);
  } catch (err) {
    if (!err.code) throw err;
    return waText_(to, '⚠️ ' + err.message);
  }
  var icons = { confirmado: '✅', entregado: '📦', cancelado: '❌' };
  var msg = (icons[estado] || '') + ' ' + nro + ' ' + estado + '. Le avisé al cliente.';
  if (estado === 'confirmado') {
    return waButtons_(to, msg, [{ id: 'st:' + nro + ':entregado', title: '📦 Marcar entregado' }]);
  }
  return waText_(to, msg);
}

// ───────────────────── Búsqueda ─────────────────────

/**
 * Productos que coinciden con el texto: primero por id o nombre exacto, luego
 * por todas las palabras (en nombre, palabras clave o id). Sin tildes.
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
    pub._text = ' ' + normalize_(pub.nombre + ' ' + pub.palabras + ' ' + pub.id) + ' ';
    pub._visible = pub.disponible && (isBlank_(p.en_whatsapp) || truthy_(p.en_whatsapp));
    return pub;
  }).filter(function (p) { return !onlyVisible || p._visible; });

  var exact = list.filter(function (p) { return p.id === q.replace(/ /g, '-') || normalize_(p.nombre) === q; });
  if (exact.length) return exact;
  var words = q.split(' ').filter(function (w) { return w.length > 1; }).map(function (w) {
    return w.length > 3 ? w.replace(/(es|s)$/, '') : w; // "mangos" → "mango", "fresas" → "fresa"
  });
  if (!words.length) return [];
  return list.filter(function (p) {
    return words.every(function (w) { return p._text.indexOf(' ' + w) >= 0; });
  });
}
