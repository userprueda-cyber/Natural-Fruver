/**
 * Mantiene el catálogo de WhatsApp (Commerce Manager de Meta) igual a la hoja.
 *
 * - Cuando un trabajador cambia un producto (por WhatsApp o la página), se
 *   envía solo ese producto.
 * - Cada hora se envía todo el catálogo, por si alguien editó la hoja a mano.
 *
 * El id del producto en la hoja es el "retailer id" en Meta: así el pedido que
 * llega del carrito de WhatsApp se cruza con la hoja.
 */

var CATALOG_BATCH = 200;
var DEFAULT_PHOTO_BASE = 'https://userprueda-cyber.github.io/Natural-Fruver/';

/** Producto de la hoja → artículo del catálogo de Meta, o null si no debe estar. */
function metaItem_(row, cfg, today) {
  if (isBlank_(row.id) || isBlank_(row.nombre) || truthy_(row.archivado)) return null;
  if (!isBlank_(row.en_whatsapp) && !truthy_(row.en_whatsapp)) return null;
  var p = publicProduct_(row, today);
  if (!(p.precio > 0)) return null;

  var base = String(cfg.url_fotos || DEFAULT_PHOTO_BASE).replace(/\/?$/, '/');
  var photo = p.foto
    ? (/^https:\/\//.test(p.foto) ? p.foto : base + p.foto)
    : base + 'img/sin-foto.jpg';
  var unit = unitLabel_(p.unidad);
  var item = {
    id: p.id,
    title: cut_(p.nombre + ' (' + unit + ')', 150),
    description: cut_(p.descripcion || ('Precio por ' + unit + '. ' + (cfg.nombre_tienda || 'Natural Fruver') + ', ' +
      (cfg.direccion_tienda || 'Pereira') + '.'), 5000),
    availability: p.disponible ? 'in stock' : 'out of stock',
    condition: 'new',
    price: metaPrice_(p.precio),
    sale_price: p.oferta !== null ? metaPrice_(p.oferta) : '',
    link: 'https://wa.me/' + String(cfg.whatsapp || '').replace(/\D/g, ''),
    image_link: photo,
    brand: cut_(cfg.nombre_tienda || 'Natural Fruver', 100),
    custom_label_0: cut_(p.categoria, 100)
  };
  if (p.oferta !== null && p.oferta_hasta) {
    item.sale_price_effective_date = today + 'T00:00-05:00/' + p.oferta_hasta + 'T23:59-05:00';
  }
  return item;
}

function metaPrice_(n) {
  return Math.round(num_(n, 0)).toFixed(2) + ' COP';
}

/** Envía productos a Meta. ids = lista de ids, o nada para enviar todos. */
function syncCatalog_(ids) {
  var catalogId = secret_('WA_CATALOG_ID');
  if (!catalogId || !secret_('WA_TOKEN')) return { ok: false, motivo: 'sin_configurar' };
  var cfg = getConfig_();
  var today = todayStr_();
  var only = null;
  if (ids) { only = {}; ids.forEach(function (id) { only[String(id)] = true; }); }

  var requests = [];
  table_(SHEETS.PRODUCTS).rows.forEach(function (row) {
    var id = String(row.id || '').trim();
    if (!id || (only && !only[id])) return;
    var item = metaItem_(row, cfg, today);
    requests.push(item ? { method: 'UPDATE', data: item } : { method: 'DELETE', data: { id: id } });
  });

  var sent = 0;
  var errors = [];
  for (var i = 0; i < requests.length; i += CATALOG_BATCH) {
    var res = graph_(catalogId + '/items_batch', {
      item_type: 'PRODUCT_ITEM',
      allow_upsert: true,
      requests: requests.slice(i, i + CATALOG_BATCH)
    });
    if (res.ok) sent += Math.min(CATALOG_BATCH, requests.length - i);
    else errors.push((res.body.error && res.body.error.message) || ('HTTP ' + res.status));
  }
  return { ok: !errors.length, enviados: sent, errores: errors };
}

/** Sincroniza sin interrumpir a quien hizo el cambio si Meta falla. */
function syncCatalogQuietly_(ids) {
  try { return syncCatalog_(ids); } catch (e) { console.warn('Sincronización del catálogo: ' + e); return null; }
}

/** Menú y activador cada hora. */
function syncWhatsAppCatalog() {
  var res = syncCatalog_();
  var msg = res.motivo === 'sin_configurar'
    ? 'Falta configurar WA_TOKEN y WA_CATALOG_ID en las Propiedades del script.'
    : 'Catálogo de WhatsApp: ' + res.enviados + ' productos enviados.' +
      (res.errores.length ? '\nErrores: ' + res.errores.join('; ') : '');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
  return res;
}
