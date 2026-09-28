/**
 * Puntos de entrada de la aplicación web (Implementar → Aplicación web).
 *
 *   GET  ?action=catalogo            → catálogo público
 *   POST {action:'pedido', ...}      → registra un pedido y descuenta inventario
 *   POST {action:'admin_*', pin, ...} → acciones de trabajadores
 *   POST {action:'wa_webhook', secret, payload} → mensajes de WhatsApp (desde relay/)
 *
 * La página envía los POST como text/plain para evitar el "preflight" de CORS,
 * que Apps Script no soporta.
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'catalogo';
  return respond_(function () {
    if (action === 'catalogo') return getCatalogCached_();
    if (action === 'ping') return { ok: true, hora: nowStr_() };
    throw userError_('accion', 'Acción desconocida.');
  });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'datos', mensaje: 'Solicitud no válida.' });
  }
  return respond_(function () { return handlePost_(body); });
}

function handlePost_(body) {
  var action = String(body.action || '');
  if (action === 'wa_webhook') return handleWebhook_(body);
  if (action === 'pedido') return createOrder_(body);

  if (action.indexOf('admin_') !== 0) throw userError_('accion', 'Acción desconocida.');
  var who = authWorker_(body.pin);
  switch (action) {
    case 'admin_login': return { ok: true, nombre: who };
    case 'admin_datos': return adminData_();
    case 'admin_guardar': return saveProduct_(body.producto, who);
    case 'admin_rapido': return quickUpdate_(body.id, body.cambios || {}, who);
    case 'admin_archivar': return archiveProduct_(body.id, body.archivar !== false, who);
    case 'admin_foto': return uploadPhoto_(body.dataUrl, body.nombre);
    case 'admin_pedido': return setOrderStatus_(body.nro, body.estado, who);
    default: throw userError_('accion', 'Acción desconocida.');
  }
}

function respond_(fn) {
  try {
    return json_(fn());
  } catch (err) {
    var out = { ok: false, error: err.code || 'interno', mensaje: err.code ? err.message : 'Error interno. Intenta de nuevo.' };
    if (err.extra) Object.keys(err.extra).forEach(function (k) { out[k] = err.extra[k]; });
    if (!err.code) console.error(err && err.stack || err);
    return json_(out);
  }
}
