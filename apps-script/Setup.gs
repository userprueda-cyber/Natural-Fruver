/**
 * Configuración inicial: crea las pestañas con sus columnas y algunos datos
 * de ejemplo. Se puede ejecutar varias veces: nunca borra datos existentes.
 */

var DEFAULT_CONFIG = [
  ['nombre_tienda', 'Natural Fruver', 'Nombre que aparece en la página'],
  ['whatsapp', '', 'Número de WhatsApp con indicativo, sin espacios. Ej: 573001234567'],
  ['instagram', 'naturalfruverpereira', 'Usuario de Instagram (sin @)'],
  ['direccion_tienda', 'Pereira, Risaralda', 'Dirección del local'],
  ['horario', 'lun-sab 07:00-19:00; dom 08:00-13:00', 'Formato: dias hh:mm-hh:mm; separados por ;'],
  ['domicilio_valor', 4000, 'Valor del domicilio en pesos (0 = gratis)'],
  ['domicilio_gratis_desde', 60000, 'Domicilio gratis desde este valor (0 = nunca)'],
  ['pedido_minimo', 0, 'Pedido mínimo en pesos (0 = sin mínimo)'],
  ['zonas_domicilio', 'Pereira y Dosquebradas', 'Texto informativo'],
  ['banner', '¡Frutas y verduras frescas todos los días!', 'Mensaje destacado arriba de la página (vacío = no se muestra)'],
  ['ocultar_agotados', 'no', 'si = los agotados no aparecen; no = aparecen como "Agotado"'],
  ['horas_cancelar_pendientes', 3, 'Pedidos sin confirmar se cancelan solos después de estas horas y el inventario vuelve (0 = nunca)'],
  ['stock_minimo_alerta', 2, 'El resumen diario avisa de productos con este inventario o menos'],
  ['correo_resumen', '', 'Correo para el resumen diario (vacío = no se envía)']
];

var SAMPLE_CATEGORIES = [
  ['Frutas', '🍓', 1],
  ['Verduras', '🥬', 2],
  ['Hierbas', '🌿', 3],
  ['Tubérculos', '🥔', 4],
  ['Granos', '🫘', 5],
  ['Huevos y lácteos', '🥚', 6],
  ['Combos', '🧺', 7]
];

// Productos de ejemplo: reemplázalos por los reales (precios de referencia).
var SAMPLE_PRODUCTS = [
  // nombre, categoria, precio, unidad, precio_oferta, stock, destacado, palabras_clave
  ['Banano', 'Frutas', 3000, 'kg', '', '', 'si', 'guineo'],
  ['Mango Tommy', 'Frutas', 6000, 'kg', 5000, 20, 'si', ''],
  ['Aguacate Hass', 'Frutas', 2500, 'unidad', '', 40, 'si', 'palta'],
  ['Fresa', 'Frutas', 9000, 'kg', '', 10, '', 'frutilla'],
  ['Maracuyá', 'Frutas', 5000, 'kg', '', '', '', 'parchita'],
  ['Mora de Castilla', 'Frutas', 7000, 'kg', '', '', '', ''],
  ['Lulo', 'Frutas', 6000, 'kg', '', '', '', 'naranjilla'],
  ['Limón Tahití', 'Frutas', 4000, 'kg', 3000, '', '', 'lima'],
  ['Tomate chonto', 'Verduras', 4500, 'kg', '', '', 'si', 'jitomate'],
  ['Cebolla cabezona', 'Verduras', 3500, 'kg', '', '', '', 'cebolla blanca'],
  ['Zanahoria', 'Verduras', 2500, 'kg', '', '', '', ''],
  ['Lechuga crespa', 'Verduras', 2000, 'unidad', '', '', '', ''],
  ['Cilantro', 'Hierbas', 1000, 'atado', '', '', '', 'culantro'],
  ['Cebolla larga', 'Hierbas', 1500, 'atado', '', '', '', 'cebollin junca'],
  ['Papa pastusa', 'Tubérculos', 2800, 'kg', '', '', '', 'patata'],
  ['Yuca', 'Tubérculos', 2500, 'kg', '', '', '', 'mandioca'],
  ['Plátano hartón', 'Tubérculos', 3000, 'kg', '', '', '', 'platano verde maduro'],
  ['Fríjol cargamanto', 'Granos', 12000, 'lb', '', '', '', 'frijol'],
  ['Huevos AA x 30', 'Huevos y lácteos', 18000, 'canasta', '', 15, '', 'huevo'],
  ['Combo sancocho', 'Combos', 15000, 'unidad', '', 10, 'si', 'papa yuca platano mazorca cilantro']
];

function setup() {
  var ss = ss_();
  var products = ensureSheet_(ss, SHEETS.PRODUCTS, PRODUCT_HEADERS);
  var categories = ensureSheet_(ss, SHEETS.CATEGORIES, CATEGORY_HEADERS);
  var orders = ensureSheet_(ss, SHEETS.ORDERS, ORDER_HEADERS);
  var config = ensureSheet_(ss, SHEETS.CONFIG, CONFIG_HEADERS);
  var workers = ensureSheet_(ss, SHEETS.WORKERS, WORKER_HEADERS);

  // Texto plano para columnas que Sheets podría "convertir" (PIN 0123, teléfonos, números de pedido).
  workers.getRange('B:B').setNumberFormat('@');
  orders.getRange('A:A').setNumberFormat('@');
  orders.getRange('E:E').setNumberFormat('@');
  products.getRange('A:A').setNumberFormat('@');

  // Config: agrega solo las claves que falten.
  var existing = {};
  table_(SHEETS.CONFIG).rows.forEach(function (r) { existing[String(r.clave).trim()] = true; });
  DEFAULT_CONFIG.forEach(function (row) { if (!existing[row[0]]) config.appendRow(row); });

  if (categories.getLastRow() < 2) {
    categories.getRange(2, 1, SAMPLE_CATEGORIES.length, 3).setValues(SAMPLE_CATEGORIES);
  }

  if (products.getLastRow() < 2) {
    var t = table_(SHEETS.PRODUCTS);
    var ids = {};
    SAMPLE_PRODUCTS.forEach(function (s, i) {
      var id = slug_(s[0]);
      while (ids[id]) id += '-x';
      ids[id] = true;
      writeRow_(t, {
        id: id, nombre: s[0], categoria: s[1], precio: s[2], unidad: s[3], precio_oferta: s[4],
        stock: s[5], disponible: 'si', destacado: s[6], palabras_clave: s[7], orden: (i + 1) * 10,
        actualizado: new Date(), actualizado_por: 'ejemplo'
      });
    });
  }

  var newPin = '';
  if (workers.getLastRow() < 2) {
    newPin = String(Math.floor(100000 + Math.random() * 900000));
    workers.appendRow(['Administrador', newPin, 'si']);
  }

  addValidation_(products, 'disponible', ['si', 'no']);
  addValidation_(products, 'destacado', ['si', 'no']);
  addValidation_(products, 'archivado', ['si', '']);
  addValidation_(products, 'unidad', ['kg', 'lb', 'unidad', 'atado', 'canasta', 'paquete', 'bandeja']);
  addValidation_(orders, 'estado', ORDER_STATES);
  addValidation_(workers, 'activo', ['si', 'no']);

  photoFolder_();
  invalidateCatalog_();

  var msg = 'Hojas listas.\n\n' +
    '1) Escribe el número de WhatsApp en la pestaña Config.\n' +
    '2) Menú Natural Fruver → Activar tareas automáticas.\n' +
    '3) Implementar → Nueva implementación → Aplicación web (ver README).';
  if (newPin) msg += '\n\nPIN del Administrador para la página de trabajadores: ' + newPin +
    '\n(puedes cambiarlo o agregar más trabajadores en la pestaña Trabajadores)';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var current = sh.getLastColumn() > 0
    ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String)
    : [];
  if (!current.filter(String).length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    // Agrega columnas nuevas al final si faltan (actualizaciones futuras).
    headers.forEach(function (h) {
      if (current.indexOf(h) < 0) {
        sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
      }
    });
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#e8f5e9');
  return sh;
}

function addValidation_(sh, header, values) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var col = headers.indexOf(header) + 1;
  if (!col) return;
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build();
  sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}
