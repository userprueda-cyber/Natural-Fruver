/**
 * Operación: métricas del día, alertas al personal, salud del sistema,
 * resúmenes y tareas cada 5 minutos (escalar asesor, reintentar avisos, recordatorios).
 */

// ───────────────────────── Métricas ─────────────────────────

var METRIC_NAMES = ['mensajes', 'sin_ia', 'ia_llamadas', 'asesor', 'pedidos', 'enviados', 'fallos_envio', 'no_entendidos', 'ignorados'];

function bumpMetric_(name, n) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'm_' + todayStr_() + '_' + name;
    props.setProperty(key, String(num_(props.getProperty(key), 0) + (n || 1)));
  } catch (e) { /* las métricas nunca deben tumbar el bot */ }
}

function metrics_(day) {
  var props = PropertiesService.getScriptProperties();
  var out = {};
  METRIC_NAMES.forEach(function (m) { out[m] = num_(props.getProperty('m_' + (day || todayStr_()) + '_' + m), 0); });
  out.ia_usd = num_(props.getProperty('ia_usd_d_' + (day || todayStr_())), 0);
  return out;
}

// ───────────────────────── Registro y alertas ─────────────────────────

function audit_(who, phone, action, detail) {
  appendLog_(SHEETS.AUDIT, { fecha: nowStr_(), quien: who || 'bot', cliente: last4_(phone), accion: action, detalle: clip_(redact_(detail || ''), 300) });
}

function logUnresolved_(phone, text, motivo) {
  appendLog_(SHEETS.UNRESOLVED, { fecha: nowStr_(), cliente: last4_(phone), texto: clip_(redact_(text), 200), motivo: motivo || '' });
}

/**
 * Avisa a todos los trabajadores por WhatsApp (y por correo si hay correo_alertas y nadie recibió).
 * buttons opcional: [{id,title}]. Devuelve cuántos lo recibieron.
 */
function alertStaff_(text, buttons, opts) {
  opts = opts || {};
  var delivered = 0;
  var list = opts.to ? [{ whatsapp: opts.to }] : workers_();
  list.forEach(function (w) {
    var to = waNumber_(w.whatsapp);
    var res;
    try {
      res = buttons && buttons.length ? waButtons_(to, text, buttons, null, { direct: true }) : waText_(to, text, { direct: true });
    } catch (e) { res = { ok: false }; }
    if (res && res.ok) delivered++;
  });
  if (!delivered || opts.email) {
    var cfg = getConfig_();
    var mail = String(cfg.correo_alertas || cfg.correo_resumen || '').trim();
    if (mail) {
      try { MailApp.sendEmail(mail, 'Natural Fruver — aviso del bot', text); } catch (e) { console.warn('Correo de alerta: ' + e); }
    }
  }
  return delivered;
}

// ───────────────────────── Salud ─────────────────────────

/** Estado del sistema para /health y el chequeo diario. No incluye datos de clientes. */
function healthCheck_() {
  var out = { ok: true, hora: nowStr_() };
  try {
    var cfg = getConfig_();
    out.hoja = 'ok';
    out.pausado = isPaused_(cfg);
    out.modo = String(cfg.modo_bot || 'autonomo');
    out.ia = llmBlockedReason_(cfg, '') || 'ok';
    out.ia_gasto_mes_usd = Math.round(usageTotals_().month * 100) / 100;
    var orders = table_(SHEETS.ORDERS).rows;
    out.pedidos_sin_aviso = orders.filter(function (r) { return r.estado === 'pendiente' && r.aviso === 'fallido'; }).length;
    out.clientes_esperando_asesor = table_(SHEETS.CLIENTS).rows.filter(function (r) { return r.asesor === 'pendiente'; }).length;
  } catch (e) {
    out.ok = false;
    out.hoja = 'error: ' + String(e).slice(0, 100);
  }
  if (secret_('WA_TOKEN') && secret_('WA_PHONE_ID')) {
    var r = graph_(secret_('WA_PHONE_ID') + '?fields=id,quality_rating', null, 'get');
    out.whatsapp = r.ok ? 'ok' : 'error ' + r.status + ' ' + (((r.body || {}).error || {}).message || '');
    if (r.ok && r.body.quality_rating) out.calidad = r.body.quality_rating;
    if (!r.ok) out.ok = false;
  } else {
    out.whatsapp = 'sin configurar';
  }
  return out;
}

/** Tarea diaria: avisa si el token de WhatsApp dejó de funcionar o la calidad bajó. */
function dailyHealthCheck() {
  var h = healthCheck_();
  var problems = [];
  if (h.hoja !== 'ok') problems.push('La hoja no responde: ' + h.hoja);
  if (/^error/.test(String(h.whatsapp))) problems.push('WhatsApp no acepta el token (' + h.whatsapp + '). Ver docs/RUNBOOK.md → "Token vencido".');
  if (h.calidad && h.calidad !== 'GREEN') problems.push('La calidad del número en WhatsApp bajó a ' + h.calidad + '.');
  if (h.pedidos_sin_aviso) problems.push(h.pedidos_sin_aviso + ' pedidos sin aviso entregado a trabajadores.');
  if (problems.length) alertStaff_('⚠️ Revisión del bot:\n• ' + problems.join('\n• '), null, { email: true });
  return h;
}

// ───────────────────────── Resúmenes ─────────────────────────

var USD_COP = 4000;

function summaryText_(day) {
  day = day || todayStr_();
  var orders = table_(SHEETS.ORDERS).rows.filter(function (r) { return dateStr_(r.fecha) === day || String(fmtDateTime_(r.fecha)).slice(0, 10) === day; });
  var sold = 0;
  orders.forEach(function (r) { if (r.estado !== 'cancelado') sold += num_(r.total, 0); });
  var m = metrics_(day);
  var pending = table_(SHEETS.ORDERS).rows.filter(function (r) { return r.estado === 'pendiente'; }).length;
  var waiting = table_(SHEETS.CLIENTS).rows.filter(function (r) { return r.asesor === 'pendiente'; }).length;
  var botPct = m.mensajes ? Math.round(100 * m.sin_ia / m.mensajes) : 0;
  return [
    '📊 *Resumen ' + day + '*',
    'Pedidos: ' + orders.length + ' · Ventas aprox.: ' + money_(sold),
    'Pendientes por confirmar: ' + pending,
    'Mensajes de clientes: ' + m.mensajes + ' (' + botPct + '% resueltos sin IA)',
    'Pasados a asesor: ' + m.asesor + (waiting ? ' · esperando ahora: ' + waiting : ''),
    'No entendidos: ' + m.no_entendidos,
    'Costo IA: US$' + (Math.round(m.ia_usd * 100) / 100) + ' (~' + money_(m.ia_usd * USD_COP) + ')',
    'Envíos fallidos: ' + m.fallos_envio
  ].join('\n');
}

/** Lo que más preguntaron los clientes y el bot no supo responder (últimos 7 días). */
function unresolvedText_() {
  var since = new Date(new Date().getTime() - 7 * 86400000);
  var counts = {};
  table_(SHEETS.UNRESOLVED).rows.forEach(function (r) {
    var d = toDate_(r.fecha);
    if (!d || d < since) return;
    var k = normalize_(r.texto).slice(0, 60);
    if (k) counts[k] = (counts[k] || 0) + 1;
  });
  var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 10);
  if (!top.length) return '🎉 Esta semana el bot entendió todo lo que le escribieron.';
  return '🤔 *Lo que el bot no entendió esta semana*\n' + top.map(function (k) { return '• ' + k + (counts[k] > 1 ? ' (×' + counts[k] + ')' : ''); }).join('\n') +
    '\n\nIdeas: agrega esos nombres en la columna *alias* de Productos o avísale al desarrollador.';
}

// ───────────────────────── Tareas cada 5 minutos ─────────────────────────

function runEveryFiveMinutes() {
  var cfg = getConfig_();
  var tasks = [escalateHandoffs_, retryOrderAlerts_, cartReminders_, eveningSummary_];
  tasks.forEach(function (fn) {
    try { fn(cfg); } catch (e) { console.error('Tarea ' + fn.name + ': ' + (e && e.stack || e)); }
  });
}

/** Reintenta avisos de pedidos nuevos que no llegaron; recuerda los que nadie ha visto. */
function retryOrderAlerts_(cfg) {
  var t = table_(SHEETS.ORDERS);
  var now = new Date().getTime();
  t.rows.forEach(function (r) {
    if (r.estado !== 'pendiente' || isBlank_(r.nro)) return;
    var tries = num_(r.aviso_intentos, 0);
    var age = now - (toDate_(r.fecha) || new Date()).getTime();
    var failed = r.aviso === 'fallido';
    var unseen = r.aviso === 'enviado' && age > 15 * 60000 && tries < 2;
    if (!(failed || unseen) || tries >= 5) return;
    var items;
    try { items = JSON.parse(r.items || '[]'); } catch (e) { items = []; }
    var ok = notifyWorkersNewOrder_({ nro: r.nro, lineas: items, total: r.total }, { nombre: r.cliente, telefono: r.telefono, direccion: r.direccion },
      { entrega: r.entrega, notas: r.notas, pago: r.pago }, unseen ? '⏰ Recordatorio: ' : '');
    setCell_(t, r, 'aviso_intentos', tries + 1);
    setCell_(t, r, 'aviso', ok ? 'enviado' : 'fallido');
    if (!ok && tries + 1 >= 3) alertStaff_('🚨 No pude avisar del pedido ' + r.nro + ' por WhatsApp. Revisa la pestaña Pedidos.', null, { email: true });
  });
}

/** Un solo recordatorio amable para pedidos sin terminar (dentro de las 24 h y sin "baja"). */
function cartReminders_(cfg) {
  var hours = num_(cfg.horas_recordatorio_carrito, 0);
  if (!(hours > 0) || isPaused_(cfg)) return;
  var t = table_(SHEETS.CLIENTS);
  var now = new Date().getTime();
  t.rows.forEach(function (r) {
    if (!r.paso || !isBlank_(r.recordatorio) || truthy_(r.bloqueado) || !isBlank_(r.baja) || !isBlank_(r.asesor)) return;
    var data;
    try { data = JSON.parse(r.datos || '{}'); } catch (e) { data = {}; }
    if (!data.carrito || !data.carrito.length) return;
    var last = toDate_(r.ultimo_mensaje) || toDate_(r.actualizado);
    if (!last) return;
    var idle = now - last.getTime();
    if (idle < hours * 3600000 || idle > 22 * 3600000) return; // nunca fuera de la ventana de 24 h
    var res = waButtons_(waNumber_(r.telefono), '¿Seguimos con tu pedido? 🧺 Lo tengo guardado. Si ya no lo necesitas, no pasa nada.', [
      { id: 'seguir', title: '🛒 Seguir pedido' },
      { id: 'cancelar', title: '❌ Ya no' }
    ]);
    setCell_(t, r, 'recordatorio', res && res.ok ? nowStr_() : 'fallido');
  });
}

function eveningSummary_(cfg) {
  var hour = String(cfg.hora_resumen === undefined ? '' : cfg.hora_resumen).trim();
  if (hour === '') return;
  if (Number(nowStr_().slice(11, 13)) !== Number(hour)) return;
  var props = PropertiesService.getScriptProperties();
  var key = 'resumen_' + todayStr_();
  if (props.getProperty(key)) return;
  props.setProperty(key, '1');
  var text = summaryText_();
  // Los lunes también va la lista de lo que el bot no entendió.
  if (localNow_().day === 1) text += '\n\n' + unresolvedText_();
  alertStaff_(text);
}
