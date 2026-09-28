/**
 * Pedidos: la página registra el pedido ANTES de abrir WhatsApp.
 * Así el inventario baja en el momento del pedido, y si el pedido se cancela
 * (a mano o automáticamente por no confirmarse) el inventario se devuelve.
 */

var MAX_ITEMS = 60;
var MAX_QTY = 50;

function createOrder_(body) {
  if (!isBlank_(body.website)) throw userError_('spam', 'Pedido rechazado.'); // campo trampa para bots

  var c = body.cliente || {};
  var customer = {
    cliente: clip_(c.nombre, 80),
    telefono: clip_(c.telefono, 20).replace(/[^\d+]/g, ''),
    entrega: c.entrega === 'recoger' ? 'recoger' : 'domicilio',
    direccion: clip_(c.direccion, 200),
    notas: clip_(c.notas, 300)
  };
  if (customer.cliente.length < 2) throw userError_('datos', 'Escribe tu nombre.');
  if (customer.telefono.replace(/\D/g, '').length < 7) throw userError_('datos', 'Escribe un teléfono válido.');
  if (customer.entrega === 'domicilio' && customer.direccion.length < 5) {
    throw userError_('datos', 'Escribe la dirección para el domicilio.');
  }

  var items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw userError_('vacio', 'El carrito está vacío.');
  if (items.length > MAX_ITEMS) throw userError_('datos', 'Demasiados productos en un solo pedido.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var cfg = getConfig_();
    var today = todayStr_();
    var t = table_(SHEETS.PRODUCTS);
    var byId = {};
    t.rows.forEach(function (p) { if (!isBlank_(p.id)) byId[String(p.id).trim()] = p; });

    // Sumar cantidades repetidas del mismo producto.
    var wanted = {};
    var orderIds = [];
    items.forEach(function (it) {
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
      if (qty > MAX_QTY) qty = MAX_QTY;
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

    var ordersT = table_(SHEETS.ORDERS);
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
      actualizado_por: 'web'
    });
    SpreadsheetApp.flush();
    invalidateCatalog_();

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

    if (estado === 'cancelado') restock_(order);

    setCell_(ordersT, order, 'estado', estado);
    setCell_(ordersT, order, 'actualizado', new Date());
    setCell_(ordersT, order, 'actualizado_por', who || '');
    SpreadsheetApp.flush();
    invalidateCatalog_();
    return { ok: true, nro: nro, estado: estado };
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
  lines.forEach(function (l) {
    if (!l.stock_controlado) return;
    var p = byId[l.id];
    if (!p || isBlank_(p.stock)) return; // el trabajador dejó de controlar stock: nada que devolver
    setCell_(t, p, 'stock', Math.round((num_(p.stock, 0) + num_(l.cantidad, 0)) * 100) / 100);
  });
}
