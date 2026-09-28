/**
 * Acciones de los trabajadores. Cada trabajador tiene un PIN en la pestaña
 * "Trabajadores"; así no necesitan cuenta de Google y queda registrado quién
 * hizo cada cambio (columna actualizado_por).
 */

var MAX_PIN_FAILS = 10;
var PIN_LOCK_SECONDS = 600;
var MAX_PHOTO_CHARS = 3 * 1024 * 1024; // ~2 MB de imagen en base64
var EDITABLE_FIELDS = [
  'nombre', 'categoria', 'precio', 'unidad', 'precio_oferta', 'oferta_hasta', 'stock',
  'disponible', 'destacado', 'foto_url', 'descripcion', 'palabras_clave', 'orden'
];

function authWorker_(pin) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('pin_fails') || 0);
  if (fails >= MAX_PIN_FAILS) {
    throw userError_('bloqueado', 'Demasiados intentos. Espera 10 minutos.');
  }
  pin = clip_(pin, 20);
  var worker = null;
  if (pin.length >= 4) {
    table_(SHEETS.WORKERS).rows.forEach(function (w) {
      var active = isBlank_(w.activo) || truthy_(w.activo);
      if (active && String(w.pin).trim() === pin) worker = String(w.nombre || 'Trabajador').trim();
    });
  }
  if (!worker) {
    cache.put('pin_fails', String(fails + 1), PIN_LOCK_SECONDS);
    throw userError_('pin', 'PIN incorrecto.');
  }
  return worker;
}

/** Todo lo que necesita la página de trabajadores en una sola llamada. */
function adminData_() {
  var today = todayStr_();
  var products = table_(SHEETS.PRODUCTS).rows
    .filter(function (p) { return !isBlank_(p.id); })
    .map(function (p) {
      var pub = publicProduct_(p, today);
      pub.precio_oferta = num_(p.precio_oferta, null);
      pub.disponible_marcado = isBlank_(p.disponible) ? true : truthy_(p.disponible);
      pub.archivado = truthy_(p.archivado);
      pub.actualizado = fmtDateTime_(p.actualizado);
      pub.actualizado_por = String(p.actualizado_por || '');
      return pub;
    });
  products.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });

  var categories = table_(SHEETS.CATEGORIES).rows
    .filter(function (c) { return !isBlank_(c.nombre); })
    .map(function (c) { return { nombre: String(c.nombre).trim(), icono: String(c.icono || '') }; });

  // Pedidos abiertos + los últimos 30 cerrados.
  var orders = table_(SHEETS.ORDERS).rows.filter(function (r) { return !isBlank_(r.nro); }).map(function (r) {
    var items;
    try { items = JSON.parse(r.items || '[]'); } catch (e) { items = []; }
    return {
      nro: String(r.nro), fecha: fmtDateTime_(r.fecha), estado: String(r.estado || 'pendiente'),
      cliente: String(r.cliente), telefono: String(r.telefono), entrega: String(r.entrega),
      direccion: String(r.direccion), notas: String(r.notas), items: items,
      subtotal: num_(r.subtotal, 0), domicilio: num_(r.domicilio, 0), total: num_(r.total, 0),
      actualizado_por: String(r.actualizado_por || '')
    };
  }).reverse();
  var open = orders.filter(function (o) { return FINAL_STATES.indexOf(o.estado) < 0; });
  var closed = orders.filter(function (o) { return FINAL_STATES.indexOf(o.estado) >= 0; }).slice(0, 30);

  return {
    ok: true,
    productos: products,
    categorias: categories,
    unidades: ['kg', 'lb', 'unidad', 'atado', 'canasta', 'paquete', 'bandeja'],
    pedidos: open.concat(closed)
  };
}

/** Crea o actualiza un producto. Solo se aceptan las columnas editables. */
function saveProduct_(input, who) {
  input = input || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var t = table_(SHEETS.PRODUCTS);
    var id = clip_(input.id, 60);
    var row = null;
    if (id) {
      t.rows.forEach(function (p) { if (String(p.id).trim() === id) row = p; });
      if (!row) throw userError_('no_existe', 'Ese producto ya no existe.');
    } else {
      row = {};
      row.id = uniqueId_(t, input.nombre);
      row.disponible = 'si';
      row.archivado = '';
    }

    EDITABLE_FIELDS.forEach(function (f) {
      if (!(f in input)) return;
      row[f] = cleanField_(f, input[f]);
    });

    if (isBlank_(row.nombre) || String(row.nombre).length < 2) throw userError_('datos', 'Falta el nombre.');
    if (!(num_(row.precio, 0) > 0)) throw userError_('datos', 'El precio debe ser mayor que 0.');
    if (!isBlank_(row.precio_oferta) && num_(row.precio_oferta, 0) >= num_(row.precio, 0)) {
      throw userError_('datos', 'El precio de oferta debe ser menor que el precio normal.');
    }

    row.actualizado = new Date();
    row.actualizado_por = who;
    writeRow_(t, row);
    SpreadsheetApp.flush();
    invalidateCatalog_();
    return { ok: true, id: row.id };
  } finally {
    lock.releaseLock();
  }
}

function cleanField_(f, v) {
  switch (f) {
    case 'precio':
    case 'orden':
      return isBlank_(v) ? '' : Math.max(0, num_(v, 0));
    case 'precio_oferta':
      return isBlank_(v) || num_(v, 0) <= 0 ? '' : num_(v, 0);
    case 'stock':
      // Vacío = no se controla inventario (solo el interruptor "disponible").
      return isBlank_(v) ? '' : Math.max(0, Math.round(num_(v, 0) * 100) / 100);
    case 'disponible':
    case 'destacado':
      return truthy_(v) ? 'si' : 'no';
    case 'oferta_hasta':
      return dateStr_(v);
    case 'unidad':
      return clip_(v, 20).toLowerCase() || 'unidad';
    case 'foto_url':
      var url = clip_(v, 500);
      return /^https:\/\//.test(url) ? url : '';
    case 'descripcion':
      return clip_(v, 400);
    case 'palabras_clave':
      return clip_(v, 200);
    default:
      return clip_(v, 80);
  }
}

function uniqueId_(t, nombre) {
  var base = slug_(nombre);
  var taken = {};
  t.rows.forEach(function (p) { taken[String(p.id).trim()] = true; });
  if (!taken[base]) return base;
  for (var i = 2; i < 1000; i++) if (!taken[base + '-' + i]) return base + '-' + i;
  return base + '-' + new Date().getTime();
}

/** Archiva (o restaura) un producto: deja de verse pero no se borra. */
function archiveProduct_(id, archived, who) {
  return patchProduct_(id, { archivado: archived ? 'si' : '' }, who);
}

/** Cambios rápidos desde la lista: disponible sí/no, stock. */
function quickUpdate_(id, changes, who) {
  var patch = {};
  if ('disponible' in changes) patch.disponible = truthy_(changes.disponible) ? 'si' : 'no';
  if ('stock' in changes) patch.stock = cleanField_('stock', changes.stock);
  return patchProduct_(id, patch, who);
}

function patchProduct_(id, patch, who) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var t = table_(SHEETS.PRODUCTS);
    var row = null;
    t.rows.forEach(function (p) { if (String(p.id).trim() === String(id)) row = p; });
    if (!row) throw userError_('no_existe', 'Ese producto ya no existe.');
    Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
    row.actualizado = new Date();
    row.actualizado_por = who;
    writeRow_(t, row);
    SpreadsheetApp.flush();
    invalidateCatalog_();
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

/** Guarda una foto (ya reducida en el celular) en la carpeta de Drive y devuelve su enlace. */
function uploadPhoto_(dataUrl, nombre) {
  var m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) throw userError_('datos', 'La foto no es válida.');
  if (m[2].length > MAX_PHOTO_CHARS) throw userError_('datos', 'La foto es muy pesada.');
  var ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], slug_(nombre) + '-' + new Date().getTime() + '.' + ext);
  var file = photoFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800' };
}

function photoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* carpeta borrada: se crea otra */ }
  }
  var folder = DriveApp.createFolder('Natural Fruver - Fotos del catálogo');
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}
