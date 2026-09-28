/**
 * Pedidos: llegan del bot de WhatsApp (Bot.gs) cuando el cliente confirma.
 * El inventario baja en el momento del pedido, y si el pedido se cancela
 * (a mano o automáticamente por no confirmarse) el inventario se devuelve.
 */

var MAX_ITEMS = 60;
var MAX_QTY = 50;

/**
 * Calcula las líneas de un pedido con los precios e inventario de la hoja
 * (nunca con precios que mande el cliente). No escribe nada.
 */
function priceItems_(items, t) {
  var today = todayStr_();
  t = t || table_(SHEETS.PRODUCTS);
  var byId = {};
  t.rows.forEach(function (p) { if (!isBlank_(p.id)) byId[String(p.id).trim()] = p; });

  // Sumar cantidades repetidas del mismo producto.
  var wanted = {};
  var orderIds = [];
  (items || []).forEach(function (it) {
    var id = clip_(it && it.id, 60);
    if (!id) return;
    if (!(id in wanted)) { wanted[id] = 0; orderIds.push(id); }
    wanted[id] += num_(it.cantidad, 0);
  });

  var lines = [];
  var problems = [];
  orderIds.forEach(function (id) {
    var p = byId[id];
    if (!p || truthy_(p.archivado)) {
      problems.push({ id: id, nombre: p ? String(p.nombre) : id, motivo: 'no_existe' });
      return;
    }
    var pub = publicProduct_(p, today);
    var qty = roundQty_(wanted[id], pub.unidad);
    if (qty <= 0) return;
    // Nunca se recorta una cantidad en silencio: se reporta y el cliente decide.
    var max = num_(p.max_cantidad, 0) || MAX_QTY;
    if (qty > max) {
      problems.push({ id: id, nombre: pub.nombre, motivo: 'cantidad', disponible: max, pedido: qty, unidad: pub.unidad });
      return;
    }
    if (!pub.disponible) {
      problems.push({ id: id, nombre: pub.nombre, motivo: 'agotado', disponible: 0 });
      return;
    }
    if (pub.stock !== null && pub.stock < qty) {
      problems.push({ id: id, nombre: pub.nombre, motivo: 'stock', disponible: pub.stock });
      return;
    }
    var price = effectivePrice_(p, today);
    lines.push({
      id: id,
      nombre: pub.nombre,
      unidad: pub.unidad,
      cantidad: qty,
      precio: price,
      total: Math.round(price * qty),
      stock_controlado: pub.stock !== null,
      _p: p
    });
  });
  return { lines: lines, problems: problems };
}

function createOrder_(body) {
  if (!isBlank_(body.website)) throw userError_('spam', 'Pedido rechazado.'); // campo trampa para bots

  var c = body.cliente || {};
  var customer = {
    cliente: clip_(c.nombre, 80),
    telefono: clip_(c.telefono, 20).replace(/[^\d+]/g, ''),
    entrega: c.entrega === 'recoger' ? 'recoger' : 'domicilio',
    direccion: clip_(c.direccion, 200),
    notas: clip_(redact_(c.notas), 300),
    pago: clip_(c.pago, 60)
  };
  if (customer.cliente.length < 2) throw userError_('datos', 'Escribe tu nombre.');
  if (customer.telefono.replace(/\D/g, '').length < 7) throw userError_('datos', 'Escribe un teléfono válido.');
  if (customer.entrega === 'domicilio' && customer.direccion.length < 5) {
    throw userError_('datos', 'Escribe la dirección para el domicilio.');
  }

  var items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw userError_('vacio', 'El carrito está vacío.');
  if (items.length > MAX_ITEMS) throw userError_('datos', 'Demasiados productos en un solo pedido.');

  var clave = clip_(body.clave, 80);
  var synced = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var cfg = getConfig_();
    var ordersT = table_(SHEETS.ORDERS);
    // Idempotencia: el mismo carrito confirmado dos veces (doble toque, reintento de Meta) es un solo pedido.
    if (clave) {
      var dup = ordersT.rows.filter(function (r) { return String(r.clave) === clave; })[0];
      if (dup) {
        var dupLines;
        try { dupLines = JSON.parse(dup.items || '[]'); } catch (e) { dupLines = []; }
        return { ok: true, duplicado: true, nro: dup.nro, lineas: dupLines, subtotal: num_(dup.subtotal, 0), domicilio: num_(dup.domicilio, 0), total: num_(dup.total, 0) };
      }
    }
    var t = table_(SHEETS.PRODUCTS);
    var priced = priceItems_(items, t);
    var lines = priced.lines;
    var problems = priced.problems;

    if (problems.length) {
      throw userError_('sin_stock', 'Algunos productos ya no están disponibles en esa cantidad.', { problemas: problems });
    }
    if (!lines.length) throw userError_('vacio', 'El carrito está vacío.');

    var subtotal = lines.reduce(function (s, l) { return s + l.total; }, 0);
    var minimo = num_(cfg.pedido_minimo, 0);
    if (minimo > 0 && subtotal < minimo) {
      throw userError_('minimo', 'El pedido mínimo es $' + minimo + '.', { minimo: minimo });
    }
    var delivery = deliveryFee_(cfg, customer.entrega, subtotal);

    // Descontar inventario.
    lines.forEach(function (l) {
      if (!l.stock_controlado) return;
      var left = Math.round((num_(l._p.stock, 0) - l.cantidad) * 100) / 100;
      setCell_(t, l._p, 'stock', left);
    });

    var nro = nextOrderNumber_(ordersT);
    var cleanLines = lines.map(function (l) {
      return { id: l.id, nombre: l.nombre, unidad: l.unidad, cantidad: l.cantidad, precio: l.precio, total: l.total, stock_controlado: l.stock_controlado };
    });
    writeRow_(ordersT, {
      nro: nro,
      fecha: new Date(),
      estado: 'pendiente',
      cliente: customer.cliente,
      telefono: customer.telefono,
      entrega: customer.entrega,
      direccion: customer.direccion,
      notas: customer.notas,
      items: JSON.stringify(cleanLines),
      subtotal: subtotal,
      domicilio: delivery,
      total: subtotal + delivery,
      actualizado: new Date(),
      actualizado_por: body.origen === 'whatsapp' ? 'whatsapp' : 'web',
      pago: customer.pago,
      clave: clave,
      revisar: body.revisar ? 'si' : ''
    });
    SpreadsheetApp.flush();
    invalidateCatalog_();
    synced = lines.filter(function (l) { return l.stock_controlado; }).map(function (l) { return l.id; });

    return {
      ok: true,
      nro: nro,
      lineas: cleanLines,
      subtotal: subtotal,
      domicilio: delivery,
      total: subtotal + delivery,
      whatsapp: String(cfg.whatsapp || '').replace(/\D/g, '')
    };
  } finally {
    lock.releaseLock();
    // Fuera del candado: una respuesta lenta de Meta no debe frenar otros pedidos.
    if (synced.length) syncCatalogQuietly_(synced);
  }
}

function deliveryFee_(cfg, entrega, subtotal) {
  if (entrega !== 'domicilio') return 0;
  var fee = num_(cfg.domicilio_valor, 0);
  var freeFrom = num_(cfg.domicilio_gratis_desde, 0);
  if (freeFrom > 0 && subtotal >= freeFrom) return 0;
  return fee;
}

function nextOrderNumber_(ordersT) {
  var max = 0;
  ordersT.rows.forEach(function (r) {
    var m = String(r.nro || '').match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  var n = String(max + 1);
  while (n.length < 4) n = '0' + n;
  return 'NF-' + n;
}

/**
 * Cambia el estado de un pedido. Al cancelar, devuelve al inventario lo que
 * se había descontado. Los pedidos entregados o cancelados ya no cambian.
 */
function setOrderStatus_(nro, estado, who) {
  if (ORDER_STATES.indexOf(estado) < 0) throw userError_('datos', 'Estado no válido.');
  var restocked = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ordersT = table_(SHEETS.ORDERS);
    var order = null;
    ordersT.rows.forEach(function (r) { if (String(r.nro) === String(nro)) order = r; });
    if (!order) throw userError_('no_existe', 'No existe el pedido ' + nro + '.');
    var current = String(order.estado || 'pendiente');
    if (current === estado) return { ok: true, nro: nro, estado: estado };
    if (FINAL_STATES.indexOf(current) >= 0) {
      throw userError_('final', 'El pedido ' + nro + ' ya está ' + current + '.');
    }
    if (estado === 'pendiente') throw userError_('datos', 'Un pedido no puede volver a pendiente.');

    restocked = estado === 'cancelado' ? restock_(order) : [];

    if (ordersT.headers.indexOf('estado_anterior') >= 0) setCell_(ordersT, order, 'estado_anterior', current + '|' + new Date().getTime());
    setCell_(ordersT, order, 'estado', estado);
    setCell_(ordersT, order, 'actualizado', new Date());
    setCell_(ordersT, order, 'actualizado_por', who || '');
    SpreadsheetApp.flush();
    invalidateCatalog_();
  } finally {
    lock.releaseLock();
  }
  if (restocked.length) syncCatalogQuietly_(restocked);
  var notice = notifyCustomerStatus_(order, estado, who);
  return { ok: true, nro: nro, estado: estado, aviso: notice };
}

/**
 * Deshace el último cambio de estado (errores del trabajador), dentro de 30 minutos.
 * No se deshace una cancelación (el inventario ya volvió): se crea un pedido nuevo.
 * No le avisa al cliente.
 */
function undoOrderStatus_(nro, who) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ordersT = table_(SHEETS.ORDERS);
    var order = ordersT.rows.filter(function (r) { return String(r.nro) === String(nro); })[0];
    if (!order) throw userError_('no_existe', 'No existe el pedido ' + nro + '.');
    var prev = String(order.estado_anterior || '').split('|');
    if (!prev[0]) throw userError_('datos', 'El pedido ' + nro + ' no tiene un cambio para deshacer.');
    if (order.estado === 'cancelado') throw userError_('datos', 'Una cancelación no se puede deshacer (el inventario ya volvió). Crea el pedido de nuevo.');
    if (new Date().getTime() - num_(prev[1], 0) > 30 * 60000) throw userError_('datos', 'Solo se puede deshacer durante 30 minutos.');
    setCell_(ordersT, order, 'estado', prev[0]);
    setCell_(ordersT, order, 'estado_anterior', '');
    setCell_(ordersT, order, 'actualizado', new Date());
    setCell_(ordersT, order, 'actualizado_por', who || '');
    audit_(who, order.telefono, 'deshacer', nro + ' → ' + prev[0]);
    return { ok: true, nro: nro, estado: prev[0] };
  } finally {
    lock.releaseLock();
  }
}

function restock_(order) {
  var lines;
  try { lines = JSON.parse(order.items || '[]'); } catch (e) { lines = []; }
  var t = table_(SHEETS.PRODUCTS);
  var byId = {};
  t.rows.forEach(function (p) { byId[String(p.id).trim()] = p; });
  var ids = [];
  lines.forEach(function (l) {
    if (!l.stock_controlado) return;
    var p = byId[l.id];
    if (!p || isBlank_(p.stock)) return; // el trabajador dejó de controlar stock: nada que devolver
    setCell_(t, p, 'stock', Math.round((num_(p.stock, 0) + num_(l.cantidad, 0)) * 100) / 100);
    ids.push(l.id);
  });
  return ids;
}
