/**
 * Configuración inicial: crea las pestañas con sus columnas y algunos datos
 * de ejemplo. Se puede ejecutar varias veces: nunca borra datos existentes.
 */

var DEFAULT_CONFIG = [
  ['nombre_tienda', 'Natural Fruver', 'Nombre que aparece en la página'],
  ['whatsapp', '573135962382', 'Número de WhatsApp con indicativo, sin espacios. Ej: 573001234567'],
  ['instagram', 'naturalfruverpereira', 'Usuario de Instagram (sin @)'],
  ['direccion_tienda', 'Kioskos de Promalabar, Malabar – Cerritos, Pereira', 'Dirección del local'],
  ['horario', 'lun-vie 08:30-18:00; sab-dom 08:30-16:00', 'Formato: dias hh:mm-hh:mm; separados por ;'],
  ['domicilio_valor', 4000, 'Valor del domicilio en pesos (0 = gratis)'],
  ['domicilio_gratis_desde', 60000, 'Domicilio gratis desde este valor (0 = nunca)'],
  ['pedido_minimo', 0, 'Pedido mínimo en pesos (0 = sin mínimo)'],
  ['zonas_domicilio', 'Pereira. Programa tu domicilio con 1 día de antelación', 'Texto informativo'],
  ['banner', '¡Abrimos sábados y domingos de 8:30 a. m. a 4:00 p. m.!', 'Mensaje destacado arriba de la página (vacío = no se muestra)'],
  ['ocultar_agotados', 'no', 'si = los agotados no aparecen; no = aparecen como "Agotado"'],
  ['horas_cancelar_pendientes', 3, 'Pedidos sin confirmar se cancelan solos después de estas horas y el inventario vuelve (0 = nunca)'],
  ['stock_minimo_alerta', 2, 'El resumen diario avisa de productos con este inventario o menos'],
  ['correo_resumen', '', 'Correo para el resumen diario (vacío = no se envía)']
];

var SAMPLE_CATEGORIES = [
  ['Frutas', '🍓', 1],
  ['Verduras', '🥬', 2],
  ['Lácteos y huevos', '🥚', 3],
  ['Carnes y embutidos', '🥩', 4],
  ['Abarrotes', '🌾', 5],
  ['Bebidas y más', '🥤', 6]
];

// Productos del catálogo publicado en Instagram (@naturalfruverpereira, julio-septiembre 2026).
// Los PRECIOS son de referencia: el catálogo no los publica. Revísalos antes de abrir la página.
var SAMPLE_PRODUCTS = [
  // nombre, categoria, precio, unidad, precio_oferta, stock, destacado, palabras_clave
  ['Banano', 'Frutas', 3000, 'kg', '', '', 'si', 'guineo'],
  ['Manzana roja', 'Frutas', 2000, 'unidad', '', '', '', ''],
  ['Manzana verde', 'Frutas', 2200, 'unidad', '', '', '', ''],
  ['Pera', 'Frutas', 2200, 'unidad', '', '', '', ''],
  ['Piña', 'Frutas', 6000, 'unidad', '', '', '', 'pina'],
  ['Naranja', 'Frutas', 3000, 'kg', '', '', '', 'jugo'],
  ['Mandarina', 'Frutas', 4000, 'kg', '', '', '', ''],
  ['Sandía', 'Frutas', 12000, 'unidad', '', '', '', 'patilla'],
  ['Lychees', 'Frutas', 20000, 'kg', '', '', '', 'lichis lychee'],
  ['Melón', 'Frutas', 7000, 'unidad', '', '', '', ''],
  ['Papaya', 'Frutas', 3500, 'kg', '', '', '', 'lechosa'],
  ['Granadilla', 'Frutas', 1200, 'unidad', '', '', '', ''],
  ['Guanábana', 'Frutas', 9000, 'kg', '', '', '', ''],
  ['Mora de Castilla', 'Frutas', 8000, 'kg', '', '', '', 'moras'],
  ['Kiwi', 'Frutas', 1500, 'unidad', '', '', '', ''],
  ['Arándanos', 'Frutas', 8000, 'paquete', '', '', '', 'blueberries'],
  ['Limón Tahití', 'Frutas', 4000, 'kg', '', '', '', 'lima tahiti'],
  ['Guayaba manzana', 'Frutas', 6000, 'kg', '', '', '', ''],
  ['Mango Tommy', 'Frutas', 6000, 'kg', '', '', 'si', ''],
  ['Aguacate papelillo', 'Frutas', 3500, 'unidad', '', '', 'si', 'palta'],
  ['Durazno', 'Frutas', 9000, 'kg', '', '', '', 'melocoton'],
  ['Pitaya amarilla', 'Frutas', 14000, 'kg', '', '', '', 'pitahaya'],
  ['Fresa', 'Frutas', 9000, 'kg', '', '', 'si', 'frutilla'],
  ['Uchuva', 'Frutas', 4000, 'paquete', '', '', '', 'aguaymanto'],
  ['Uvas chilenas rojas', 'Frutas', 14000, 'kg', '', '', '', 'uva roja'],
  ['Uvas verdes', 'Frutas', 14000, 'kg', '', '', '', 'uva verde'],
  ['Lulo', 'Frutas', 6000, 'kg', '', '', '', 'naranjilla'],

  ['Lechuga crespa', 'Verduras', 2500, 'unidad', '', '', '', ''],
  ['Lechuga romana', 'Verduras', 3000, 'unidad', '', '', '', ''],
  ['Espinaca', 'Verduras', 2500, 'atado', '', '', '', ''],
  ['Acelga', 'Verduras', 2000, 'atado', '', '', '', ''],
  ['Brócoli', 'Verduras', 4000, 'unidad', '', '', '', 'brocoli'],
  ['Coliflor', 'Verduras', 4500, 'unidad', '', '', '', ''],
  ['Repollo verde', 'Verduras', 3500, 'unidad', '', '', '', 'col'],
  ['Repollo morado', 'Verduras', 4500, 'unidad', '', '', '', 'col morada'],
  ['Pepino cohombro', 'Verduras', 3000, 'kg', '', '', '', 'pepino'],
  ['Pimentón mixto', 'Verduras', 7000, 'kg', '', '', '', 'pimenton rojo amarillo verde'],
  ['Zanahoria', 'Verduras', 2500, 'kg', '', '', '', ''],
  ['Cebolla cabezona roja', 'Verduras', 4000, 'kg', '', '', '', 'cebolla morada'],
  ['Cebolla cabezona blanca', 'Verduras', 3500, 'kg', '', '', '', 'cebolla blanca'],
  ['Cebolla larga', 'Verduras', 1500, 'atado', '', '', '', 'cebollin junca'],
  ['Ajo', 'Verduras', 800, 'unidad', '', '', '', 'ajos cabeza'],
  ['Papa criolla', 'Verduras', 4500, 'kg', '', '', '', 'patata amarilla'],
  ['Papa pastusa', 'Verduras', 2800, 'kg', '', '', '', 'patata'],
  ['Papa nevada', 'Verduras', 3000, 'kg', '', '', '', 'patata'],
  ['Tomate chonto', 'Verduras', 4500, 'kg', '', '', 'si', 'jitomate'],
  ['Tomate milano', 'Verduras', 4500, 'kg', '', '', '', 'jitomate'],
  ['Tomate cherry', 'Verduras', 5000, 'bandeja', '', '', '', ''],
  ['Habichuela', 'Verduras', 5000, 'kg', '', '', '', 'judia verde ejote'],
  ['Arveja verde', 'Verduras', 8000, 'kg', '', '', '', 'guisante'],
  ['Ahuyama', 'Verduras', 2500, 'kg', '', '', '', 'zapallo calabaza auyama'],
  ['Calabacín', 'Verduras', 4000, 'kg', '', '', '', 'zucchini'],
  ['Berenjena', 'Verduras', 4000, 'kg', '', '', '', ''],
  ['Mazorcas en bandeja', 'Verduras', 6000, 'bandeja', '', '', '', 'maiz choclo'],
  ['Espárragos', 'Verduras', 9000, 'paquete', '', '', '', 'esparragos'],
  ['Remolacha', 'Verduras', 3000, 'kg', '', '', '', 'betarraga'],
  ['Rabanito', 'Verduras', 2000, 'atado', '', '', '', 'rabano'],
  ['Cebolla puerro', 'Verduras', 2500, 'unidad', '', '', '', 'puerro'],

  ['Queso campesino 500 g', 'Lácteos y huevos', 12000, 'unidad', '', '', '', 'lacteos de la finca'],
  ['Queso campesino 1 kg', 'Lácteos y huevos', 22000, 'unidad', '', '', '', 'lacteos de la finca'],
  ['Queso mozzarella Alpina en bloque 250 g', 'Lácteos y huevos', 11000, 'unidad', '', '', '', 'mozarela'],
  ['Queso mozzarella Alpina tajado 240 g', 'Lácteos y huevos', 11500, 'unidad', '', '', '', 'mozarela tajadas'],
  ['Queso sabanero Alpina tajado', 'Lácteos y huevos', 12000, 'unidad', '', '', '', 'tajadas'],
  ['Queso parmesano Alpina 40 g', 'Lácteos y huevos', 6000, 'unidad', '', '', '', ''],
  ['Mantequilla pura de vaca 125 g', 'Lácteos y huevos', 7000, 'unidad', '', '', '', 'lacteos de la finca'],
  ['Mantequilla Alpina con sal 125 g', 'Lácteos y huevos', 7500, 'unidad', '', '', '', ''],
  ['Mantequilla Alpina sin sal 125 g', 'Lácteos y huevos', 7500, 'unidad', '', '', '', ''],
  ['Leche Alpina entera caja 1 L', 'Lácteos y huevos', 5500, 'unidad', '', '', '', ''],
  ['Leche Alpina deslactosada caja 1 L', 'Lácteos y huevos', 6000, 'unidad', '', '', '', 'sin lactosa'],
  ['Leche Alpina entera bolsa 1,1 L', 'Lácteos y huevos', 5000, 'unidad', '', '', '', ''],
  ['Leche Alpina deslactosada bolsa 1,1 L', 'Lácteos y huevos', 5500, 'unidad', '', '', '', 'sin lactosa'],
  ['Crema de leche Alpina 200 ml', 'Lácteos y huevos', 5000, 'unidad', '', '', '', 'cremache'],
  ['Crema de leche Alpina 110 ml', 'Lácteos y huevos', 3000, 'unidad', '', '', '', 'cremache'],
  ['Yogurt griego Alpina', 'Lácteos y huevos', 6000, 'unidad', '', '', '', 'yogur'],
  ['Yogurt Finesse vaso', 'Lácteos y huevos', 3500, 'unidad', '', '', '', 'yogur'],
  ['Avena Alpina original', 'Lácteos y huevos', 3500, 'unidad', '', '', '', ''],
  ['Avena Finesse botella', 'Lácteos y huevos', 4500, 'unidad', '', '', '', ''],
  ['Huevos AA x 30', 'Lácteos y huevos', 18000, 'canasta', '', '', 'si', 'huevo panal'],
  ['Huevos AAA x 30', 'Lácteos y huevos', 21000, 'canasta', '', '', '', 'huevo panal'],
  ['Huevos de pastoreo El Tigre', 'Lácteos y huevos', 16000, 'paquete', '', '', '', 'huevo campesino'],

  ['Costilla especial Lomus 500 g', 'Carnes y embutidos', 12000, 'paquete', '', '', '', 'cerdo'],
  ['Filete de pierna Lomus', 'Carnes y embutidos', 24000, 'kg', '', '', '', 'cerdo'],
  ['Lomo de cerdo en mariposa Lomus', 'Carnes y embutidos', 28000, 'kg', '', '', '', ''],
  ['Lomo en medallones Lomus', 'Carnes y embutidos', 28000, 'kg', '', '', '', 'cerdo'],
  ['Tocineta en bloque Lomus', 'Carnes y embutidos', 26000, 'kg', '', '', '', 'tocino cerdo'],
  ['Trocitos de chicharrón Lomus', 'Carnes y embutidos', 24000, 'kg', '', '', '', 'chicharron cerdo'],
  ['Ossobuco Lomus', 'Carnes y embutidos', 18000, 'kg', '', '', '', 'osobuco cerdo'],
  ['Solomito de cerdo Lomus', 'Carnes y embutidos', 30000, 'kg', '', '', '', 'lomito'],
  ['Fajitas de cerdo Lomus', 'Carnes y embutidos', 24000, 'kg', '', '', '', ''],
  ['Cubitos de cerdo Lomus', 'Carnes y embutidos', 22000, 'kg', '', '', '', ''],
  ['Bondiola en bloque Lomus', 'Carnes y embutidos', 24000, 'kg', '', '', '', 'cerdo'],
  ['Tiras de chicharrón Lomus', 'Carnes y embutidos', 24000, 'kg', '', '', '', 'chicharron cerdo'],
  ['Filete de bondiola Lomus', 'Carnes y embutidos', 26000, 'kg', '', '', '', 'cerdo'],
  ['Chuletón de bondiola Lomus', 'Carnes y embutidos', 25000, 'kg', '', '', '', 'chuleta cerdo'],
  ['Chuleta inspiración valluna Lomus', 'Carnes y embutidos', 24000, 'kg', '', '', '', 'cerdo'],
  ['Punta de anca de cerdo Lomus', 'Carnes y embutidos', 30000, 'kg', '', '', '', ''],
  ['Costilla baby Lomus', 'Carnes y embutidos', 26000, 'kg', '', '', '', 'cerdo bbq'],
  ['Chorizo gourmet El Samán', 'Carnes y embutidos', 15000, 'paquete', '', '', '', ''],
  ['Chorizo Santa Rosano San Miguel', 'Carnes y embutidos', 14000, 'paquete', '', '', '', 'santarosano'],
  ['Jamón de cerdo Pietrán', 'Carnes y embutidos', 9000, 'paquete', '', '', '', 'zenu jamon'],
  ['Salchicha Ranchera', 'Carnes y embutidos', 12000, 'paquete', '', '', '', 'zenu perro'],
  ['Hamburguesa pre-asada Ranchera', 'Carnes y embutidos', 14000, 'paquete', '', '', '', 'zenu carne'],
  ['Salchichón cervecero Ranchera', 'Carnes y embutidos', 10000, 'unidad', '', '', '', 'zenu salchichon'],

  ['Café especial en grano', 'Abarrotes', 25000, 'paquete', '', '', '', 'cafe colombiano'],
  ['Café especial molido', 'Abarrotes', 25000, 'paquete', '', '', '', 'cafe colombiano'],
  ['Azúcar blanca', 'Abarrotes', 4500, 'paquete', '', '', '', 'azucar'],
  ['Azúcar morena de caña', 'Abarrotes', 5000, 'paquete', '', '', '', 'azucar'],
  ['Sal refinada', 'Abarrotes', 2000, 'paquete', '', '', '', ''],
  ['Harina de trigo 1 kg', 'Abarrotes', 4000, 'paquete', '', '', '', ''],
  ['Maizena 400 g', 'Abarrotes', 6500, 'paquete', '', '', '', 'fecula de maiz'],
  ['Pasta de ajo', 'Abarrotes', 6000, 'unidad', '', '', '', ''],
  ['Arroz integral', 'Abarrotes', 7000, 'paquete', '', '', '', ''],
  ['Arroz blanco premium 1 kg', 'Abarrotes', 5000, 'paquete', '', '', '', ''],

  ['Helados caseros', 'Bebidas y más', 4000, 'unidad', '', '', 'si', 'helado paleta oreo'],
  ['Barquillos Chalupo con helado', 'Bebidas y más', 8000, 'unidad', '', '', 'si', 'helado postre chalupo'],
  ['Gaseosa grande', 'Bebidas y más', 6000, 'unidad', '', '', '', 'coca cola sprite fanta postobon colombiana refresco'],
  ['Gaseosa personal', 'Bebidas y más', 3000, 'unidad', '', '', '', 'coca cola sprite fanta postobon colombiana refresco'],
  ['Cerveza Alchemy Imperial Lager', 'Bebidas y más', 8000, 'unidad', '', '', '', 'artesanal'],
  ['Cerveza Club Colombia', 'Bebidas y más', 3500, 'unidad', '', '', '', ''],
  ['Cerveza Águila Light', 'Bebidas y más', 3000, 'unidad', '', '', '', 'aguila'],
  ['Cerveza Águila Original', 'Bebidas y más', 3000, 'unidad', '', '', '', 'aguila'],
  ['Cerveza Corona Extra', 'Bebidas y más', 5500, 'unidad', '', '', '', 'importada'],
  ['Cerveza Stella Artois', 'Bebidas y más', 5500, 'unidad', '', '', '', 'importada']
];

// Fotos incluidas en la página (site/img/productos/<id>.jpg), recortadas del mismo catálogo.
// Estos productos no salen completos en el catálogo y quedan sin foto.
var SAMPLE_WITHOUT_PHOTO = ['lulo', 'esparragos', 'remolacha', 'rabanito', 'cebolla-puerro'];

function samplePhoto_(id) {
  return SAMPLE_WITHOUT_PHOTO.indexOf(id) < 0 ? PHOTO_DIR + id + '.jpg' : '';
}

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
        stock: s[5], disponible: 'si', destacado: s[6], foto_url: samplePhoto_(id), palabras_clave: s[7], orden: (i + 1) * 10,
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

/**
 * Para hojas creadas antes de que existieran las fotos: pone la foto incluida
 * a los productos que no tienen ninguna. No cambia fotos que ya estén puestas.
 */
function addCatalogPhotos() {
  var t = table_(SHEETS.PRODUCTS);
  var known = {};
  SAMPLE_PRODUCTS.forEach(function (s) { known[slug_(s[0])] = true; });
  var count = 0;
  t.rows.forEach(function (p) {
    var id = String(p.id).trim();
    if (known[id] && isBlank_(p.foto_url) && samplePhoto_(id)) {
      setCell_(t, p, 'foto_url', samplePhoto_(id));
      count++;
    }
  });
  invalidateCatalog_();
  var msg = 'Fotos agregadas: ' + count;
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
  return count;
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
