/**
 * Catálogo público: lo que ve el cliente en la página.
 * Se guarda en caché unos minutos para que la página cargue rápido y no
 * gastemos la cuota de Google. Cualquier cambio desde la página de
 * trabajadores (o editando la hoja) borra la caché.
 */

var CACHE_KEY = 'catalogo_v1';
var CACHE_SECONDS = 300;

// Claves de Config que NO se envían al público.
var PRIVATE_CONFIG_KEYS = ['correo_resumen', 'horas_cancelar_pendientes', 'stock_minimo_alerta'];

function getCatalogCached_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var catalog = buildCatalog_();
  var text = JSON.stringify(catalog);
  if (text.length < 90000) cachePut_(CACHE_KEY, text, CACHE_SECONDS); // límite de CacheService: 100 KB
  return catalog;
}

function invalidateCatalog_() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}

function buildCatalog_() {
  var cfg = getConfig_();
  var today = todayStr_();
  var hideSoldOut = truthy_(cfg.ocultar_agotados);

  var products = table_(SHEETS.PRODUCTS).rows
    .filter(function (p) { return !isBlank_(p.id) && !isBlank_(p.nombre) && !truthy_(p.archivado); })
    .map(function (p) { return publicProduct_(p, today); })
    .filter(function (p) { return !hideSoldOut || p.disponible; });

  products.sort(function (a, b) {
    return (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es');
  });

  var used = {};
  products.forEach(function (p) { used[p.categoria] = true; });
  var categories = table_(SHEETS.CATEGORIES).rows
    .filter(function (c) { return !isBlank_(c.nombre); })
    .map(function (c) {
      return { nombre: String(c.nombre).trim(), icono: String(c.icono || '').trim(), orden: num_(c.orden, 999) };
    })
    .sort(function (a, b) { return a.orden - b.orden; });
  // Categorías usadas en productos pero no creadas en la pestaña Categorias.
  var known = {};
  categories.forEach(function (c) { known[c.nombre] = true; });
  Object.keys(used).forEach(function (name) {
    if (!known[name]) categories.push({ nombre: name, icono: '', orden: 999 });
  });

  return {
    ok: true,
    generado: new Date().toISOString(),
    config: publicConfig_(cfg),
    categorias: categories.filter(function (c) { return used[c.nombre]; }),
    productos: products
  };
}

function publicConfig_(cfg) {
  var out = {};
  Object.keys(cfg).forEach(function (k) {
    if (PRIVATE_CONFIG_KEYS.indexOf(k) >= 0) return;
    var v = cfg[k];
    out[k] = Object.prototype.toString.call(v) === '[object Date]' ? dateStr_(v) : v;
  });
  return out;
}

/** Convierte una fila de la hoja al formato público del catálogo. */
function publicProduct_(p, today) {
  var precio = num_(p.precio, 0);
  var stockTracked = !isBlank_(p.stock);
  var stock = stockTracked ? num_(p.stock, 0) : null;
  var disponible = !isBlank_(p.disponible) ? truthy_(p.disponible) : true;
  if (stockTracked && stock <= 0) disponible = false;
  if (precio <= 0) disponible = false;
  return {
    id: String(p.id).trim(),
    nombre: String(p.nombre).trim(),
    categoria: String(p.categoria || 'Otros').trim(),
    precio: precio,
    unidad: String(p.unidad || 'unidad').trim().toLowerCase(),
    oferta: activeOffer_(p, today),
    oferta_hasta: dateStr_(p.oferta_hasta),
    stock: stock,
    disponible: disponible,
    destacado: truthy_(p.destacado),
    foto: String(p.foto_url || '').trim(),
    descripcion: String(p.descripcion || '').trim(),
    palabras: String(p.palabras_clave || '').trim(),
    orden: num_(p.orden, 999)
  };
}

/** Precio de oferta vigente, o null. La oferta vence sola al pasar oferta_hasta. */
function activeOffer_(p, today) {
  var precio = num_(p.precio, 0);
  var oferta = num_(p.precio_oferta, 0);
  if (!(oferta > 0 && oferta < precio)) return null;
  var hasta = dateStr_(p.oferta_hasta);
  if (hasta && hasta < today) return null;
  return oferta;
}

/** Precio que se cobra hoy por unidad. */
function effectivePrice_(p, today) {
  var oferta = activeOffer_(p, today);
  return oferta !== null ? oferta : num_(p.precio, 0);
}
