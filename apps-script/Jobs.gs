/**
 * Menú de la hoja y tareas automáticas (activadores de tiempo).
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Natural Fruver')
    .addItem('1. Configurar hojas (primera vez)', 'setup')
    .addItem('2. Activar tareas automáticas', 'installTriggers')
    .addSeparator()
    .addItem('Sincronizar catálogo de WhatsApp', 'syncWhatsAppCatalog')
    .addItem('Actualizar catálogo ahora', 'refreshCatalogNow')
    .addItem('Agregar fotos del catálogo', 'addCatalogPhotos')
    .addItem('Cancelar pedidos pendientes vencidos', 'cancelStalePendingOrders')
    .addItem('Enviar resumen diario ahora', 'sendDailySummary')
    .addSeparator()
    .addItem('Pausar el bot', 'pauseBot')
    .addItem('Reanudar el bot', 'resumeBot')
    .addItem('Revisar salud del bot', 'showHealth')
    .addToUi();
}

function pauseBot() { setPaused_(true, 'menú de la hoja'); }
function resumeBot() { setPaused_(false, 'menú de la hoja'); }
function showHealth() {
  var h = healthCheck_();
  var text = JSON.stringify(h, null, 2);
  try { SpreadsheetApp.getUi().alert(text); } catch (e) { console.log(text); }
}

/** Al editar la hoja a mano, la página se actualiza en el siguiente minuto. */
function onEdit() {
  invalidateCatalog_();
}

function refreshCatalogNow() {
  invalidateCatalog_();
  getCatalogCached_();
}

/** Crea los activadores: cada hora (pedidos vencidos y catálogo de WhatsApp) y cada mañana (resumen). */
function installTriggers() {
  var handlers = ['cancelStalePendingOrders', 'sendDailySummary', 'refreshCatalogNow', 'syncWhatsAppCatalog', 'runEveryFiveMinutes', 'dailyHealthCheck'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshCatalogNow').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('cancelStalePendingOrders').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('syncWhatsAppCatalog').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('sendDailySummary').timeBased().atHour(6).everyDays(1).create();
  // Escalar chats sin atender, reintentar avisos de pedidos, recordatorios y resumen de la noche.
  ScriptApp.newTrigger('runEveryFiveMinutes').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('dailyHealthCheck').timeBased().atHour(7).everyDays(1).create();
  try {
    SpreadsheetApp.getUi().alert('Listo: tareas automáticas activadas.');
  } catch (e) { /* ejecutado desde el editor, sin interfaz */ }
}

/**
 * Cancela los pedidos que siguen "pendiente" después de N horas
 * (Config: horas_cancelar_pendientes, 0 = nunca) y devuelve su inventario.
 */
function cancelStalePendingOrders() {
  var hours = num_(getConfig_().horas_cancelar_pendientes, 0);
  if (!(hours > 0)) return 0;
  var limit = new Date().getTime() - hours * 3600 * 1000;
  var stale = table_(SHEETS.ORDERS).rows.filter(function (r) {
    var d = toDate_(r.fecha);
    return String(r.estado) === 'pendiente' && d && d.getTime() < limit;
  });
  stale.forEach(function (r) { setOrderStatus_(r.nro, 'cancelado', 'automático'); });
  return stale.length;
}

/** Correo diario: pedidos de ayer y productos con poco inventario (Config: correo_resumen). */
function sendDailySummary() {
  var cfg = getConfig_();
  var to = String(cfg.correo_resumen || '').trim();
  if (!to) return null;

  var yesterday = new Date(new Date().getTime() - 24 * 3600 * 1000);
  var day = Utilities.formatDate(yesterday, tz_(), 'yyyy-MM-dd');
  var orders = table_(SHEETS.ORDERS).rows.filter(function (r) {
    var d = toDate_(r.fecha);
    return d && Utilities.formatDate(d, tz_(), 'yyyy-MM-dd') === day;
  });
  var byState = {};
  var sold = 0;
  orders.forEach(function (r) {
    byState[r.estado] = (byState[r.estado] || 0) + 1;
    if (r.estado !== 'cancelado') sold += num_(r.total, 0);
  });

  var threshold = num_(cfg.stock_minimo_alerta, 2);
  var low = table_(SHEETS.PRODUCTS).rows.filter(function (p) {
    return !truthy_(p.archivado) && !isBlank_(p.stock) && num_(p.stock, 0) <= threshold;
  });

  var lines = [];
  lines.push('Resumen de ' + day);
  lines.push('');
  lines.push('Pedidos: ' + orders.length);
  Object.keys(byState).forEach(function (s) { lines.push('  - ' + s + ': ' + byState[s]); });
  lines.push('Ventas (sin cancelados): $' + sold.toLocaleString('es-CO'));
  lines.push('');
  lines.push('Poco inventario (≤ ' + threshold + '):');
  if (!low.length) lines.push('  (ninguno)');
  low.forEach(function (p) { lines.push('  - ' + p.nombre + ': ' + p.stock + ' ' + (p.unidad || '')); });
  lines.push('');
  lines.push('Hoja: ' + ss_().getUrl());

  MailApp.sendEmail(to, 'Natural Fruver — resumen ' + day, lines.join('\n'));
  return lines.join('\n');
}
