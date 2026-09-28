/**
 * Natural Fruver — utilidades compartidas.
 * La hoja de cálculo es la "base de datos": cada pestaña es una tabla cuya
 * primera fila contiene los nombres de las columnas.
 */

var SHEETS = {
  PRODUCTS: 'Productos',
  CATEGORIES: 'Categorias',
  ORDERS: 'Pedidos',
  CONFIG: 'Config',
  WORKERS: 'Trabajadores',
  CLIENTS: 'Clientes',
  UNITS: 'Unidades',
  USAGE: 'Uso',
  UNRESOLVED: 'SinResolver',
  AUDIT: 'Registro'
};

// Súbelo cuando cambien las columnas: migrateSchema_ agrega las que falten en hojas ya creadas.
var SCHEMA_VERSION = 2;

var PRODUCT_HEADERS = [
  'id', 'nombre', 'categoria', 'precio', 'unidad', 'precio_oferta', 'oferta_hasta',
  'stock', 'disponible', 'destacado', 'foto_url', 'descripcion', 'palabras_clave',
  'orden', 'archivado', 'actualizado', 'actualizado_por', 'en_whatsapp', 'alias', 'max_cantidad'
];
var CATEGORY_HEADERS = ['nombre', 'icono', 'orden'];
var ORDER_HEADERS = [
  'nro', 'fecha', 'estado', 'cliente', 'telefono', 'entrega', 'direccion', 'notas',
  'items', 'subtotal', 'domicilio', 'total', 'actualizado', 'actualizado_por',
  'pago', 'clave', 'aviso', 'aviso_intentos', 'estado_anterior', 'revisar'
];
var CONFIG_HEADERS = ['clave', 'valor', 'nota'];
var WORKER_HEADERS = ['nombre', 'pin', 'activo', 'whatsapp'];
// Clientes del bot de WhatsApp: datos guardados y en qué paso de la conversación van.
var CLIENT_HEADERS = [
  'telefono', 'nombre', 'direccion', 'paso', 'datos', 'actualizado',
  'ultimo_mensaje', 'consentimiento', 'baja', 'bloqueado', 'asesor', 'asesor_desde', 'asesor_motivo',
  'asesor_ultimo', 'recordatorio'
];
var UNIT_HEADERS = ['unidad', 'sinonimos', 'gramos'];
var USAGE_HEADERS = ['fecha', 'cliente', 'funcion', 'modelo', 'entrada', 'cache_lectura', 'cache_escritura', 'salida', 'costo_usd'];
var UNRESOLVED_HEADERS = ['fecha', 'cliente', 'texto', 'motivo'];
var AUDIT_HEADERS = ['fecha', 'quien', 'cliente', 'accion', 'detalle'];

// Carpeta de las fotos que vienen con la página (relativa a site/).
var PHOTO_DIR = 'img/productos/';

var ORDER_STATES = ['pendiente', 'confirmado', 'en_preparacion', 'en_camino', 'entregado', 'cancelado'];
var STATE_LABELS = { pendiente: 'pendiente', confirmado: 'confirmado', en_preparacion: 'en preparación', en_camino: 'en camino', entregado: 'entregado', cancelado: 'cancelado' };
var FINAL_STATES = ['entregado', 'cancelado'];
var DECIMAL_UNITS = ['kg', 'lb'];

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** Lee una pestaña completa como lista de objetos { columna: valor, _row: n }. */
function table_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Falta la pestaña "' + name + '". Ejecuta "Configurar hojas".');
  var values = sh.getDataRange().getValues();
  var headers = (values[0] || []).map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) o[headers[j]] = values[i][j];
    rows.push(o);
  }
  return { sh: sh, headers: headers, rows: rows };
}

/** Escribe un objeto en su fila (o lo agrega al final si no tiene _row). */
function writeRow_(t, obj) {
  var row = t.headers.map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : obj[h]; });
  if (obj._row) {
    t.sh.getRange(obj._row, 1, 1, row.length).setValues([row]);
  } else {
    t.sh.appendRow(row);
    obj._row = t.sh.getLastRow();
  }
  return obj;
}

/** Actualiza una sola celda de una fila por nombre de columna. */
function setCell_(t, rowObj, header, value) {
  var col = t.headers.indexOf(header);
  if (col < 0) throw new Error('Columna desconocida: ' + header);
  t.sh.getRange(rowObj._row, col + 1).setValue(value);
  rowObj[header] = value;
}

/**
 * Agrega pestañas y columnas nuevas a hojas creadas con una versión anterior.
 * Corre una vez por versión (se guarda en Propiedades del script).
 */
function migrateSchema_() {
  var props = PropertiesService.getScriptProperties();
  if (String(props.getProperty('SCHEMA_VERSION') || '') === String(SCHEMA_VERSION)) return false;
  var ss = ss_();
  if (!ss.getSheetByName(SHEETS.CONFIG)) return false; // sin configurar todavía
  [[SHEETS.PRODUCTS, PRODUCT_HEADERS], [SHEETS.ORDERS, ORDER_HEADERS], [SHEETS.CLIENTS, CLIENT_HEADERS],
    [SHEETS.UNITS, UNIT_HEADERS], [SHEETS.USAGE, USAGE_HEADERS], [SHEETS.UNRESOLVED, UNRESOLVED_HEADERS],
    [SHEETS.AUDIT, AUDIT_HEADERS]].forEach(function (x) { ensureSheet_(ss, x[0], x[1]); });
  addMissingConfig_();
  props.setProperty('SCHEMA_VERSION', String(SCHEMA_VERSION));
  return true;
}

/** Agrega al final de una pestaña; si la pestaña no existe, no hace nada. */
function appendLog_(name, obj) {
  try {
    var sh = ss_().getSheetByName(name);
    if (!sh) return;
    var t = table_(name);
    writeRow_(t, obj);
  } catch (e) {
    console.warn('No se pudo registrar en ' + name + ': ' + e);
  }
}

/** Últimos 4 dígitos de un teléfono, para registros sin datos personales completos. */
function last4_(phone) {
  var d = String(phone || '').replace(/\D/g, '');
  return d ? '…' + d.slice(-4) : '';
}

function getConfig_() {
  var cfg = {};
  table_(SHEETS.CONFIG).rows.forEach(function (r) {
    var k = String(r.clave || '').trim();
    if (k) cfg[k] = r.valor;
  });
  return cfg;
}

function truthy_(v) {
  if (v === true) return true;
  var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  return s === 'si' || s === 'sí' || s === 'true' || s === 'x' || s === '1' || s === 'yes';
}

function isBlank_(v) {
  return v === '' || v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function num_(v, fallback) {
  if (typeof v === 'number') return isFinite(v) ? v : fallback;
  if (isBlank_(v)) return fallback;
  var n = Number(String(v).replace(/[$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return isFinite(n) ? n : fallback;
}

function tz_() {
  return ss_().getSpreadsheetTimeZone() || 'America/Bogota';
}

/** Fecha como 'yyyy-MM-dd' (acepta Date o texto). */
function dateStr_(v) {
  if (isBlank_(v)) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // dd/mm/aaaa (formato colombiano)
  if (m) return m[3] + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
  return '';
}

function pad2_(n) {
  n = String(n);
  return n.length < 2 ? '0' + n : n;
}

function todayStr_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

function nowStr_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm');
}

function isDecimalUnit_(unidad) {
  return DECIMAL_UNITS.indexOf(String(unidad || '').trim().toLowerCase()) >= 0;
}

/** Redondea la cantidad al paso de la unidad (0.25 kg = media libra, 0.5 lb, 1 para el resto). */
function roundQty_(qty, unidad) {
  var q = num_(qty, 0);
  var u = String(unidad || '').trim().toLowerCase();
  if (u === 'kg') return Math.round(q * 4) / 4;
  if (u === 'lb') return Math.round(q * 2) / 2;
  return Math.round(q);
}

/** Texto sin tildes, en minúsculas y con espacios simples (para buscar). */
function normalize_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** $ 12.500 */
function money_(n) {
  var s = String(Math.round(num_(n, 0)));
  return '$' + s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 2.5 → "2,5" */
function qtyStr_(q) {
  return String(Math.round(num_(q, 0) * 100) / 100).replace('.', ',');
}

var UNIT_LABELS = { unidad: 'und', kg: 'kg', lb: 'lb', atado: 'atado', canasta: 'canasta', paquete: 'paq', bandeja: 'bandeja' };
function unitLabel_(u) {
  u = String(u || 'unidad').toLowerCase();
  return UNIT_LABELS[u] || u;
}

function slug_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'producto';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function clip_(v, max) {
  return String(v === undefined || v === null ? '' : v).trim().slice(0, max);
}

/** Error con un código que la página puede mostrar al usuario. */
function userError_(code, message, extra) {
  var e = new Error(message || code);
  e.code = code;
  e.extra = extra;
  return e;
}

/** Fecha y hora legible ('yyyy-MM-dd HH:mm'); Sheets convierte textos de fecha en Date. */
function fmtDateTime_(v) {
  if (isBlank_(v)) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm');
  }
  return String(v);
}

/** Convierte una celda de fecha (Date o texto) a Date, o null. */
function toDate_(v) {
  if (isBlank_(v)) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return v;
  var d = new Date(String(v).replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}
