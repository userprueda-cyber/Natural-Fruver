/**
 * Pasar a una persona (asesor). Mientras una persona atiende un chat, el bot se queda callado.
 *
 * Clientes.asesor:  ''          → el bot atiende
 *                   'pendiente' → pidió asesor y nadie lo ha tomado
 *                   <nombre>/'app' → lo atiende esa persona (o respondieron desde la app de WhatsApp Business)
 * El bot vuelve solo después de minutos_devolver_bot sin mensajes de la persona, o con "devolver".
 */

var HANDOFF_REASONS = {
  pedido: 'pidió hablar con una persona',
  queja: 'tiene una queja o reclamo',
  salud: 'preguntó algo de salud o alergias',
  imagen: 'mandó una imagen',
  pago: 'dice que ya pagó (verificar en Nequi/banco)',
  grande: 'pedido grande para revisar',
  no_entiendo: 'el bot no le entendió dos veces',
  error: 'falla del sistema al procesar su mensaje',
  direccion: 'dirección que el bot no pudo validar',
  cancelar: 'quiere cambiar o cancelar un pedido ya confirmado',
  menor: 'dice ser menor de edad',
  otro: 'necesita ayuda'
};

function handoffActive_(c) {
  return !isBlank_(c.row.asesor);
}

/** ¿Ya pasó el tiempo sin que la persona escriba? Entonces el bot retoma el chat. */
function handoffExpired_(c, cfg) {
  if (!handoffActive_(c)) return false;
  var minutes = num_(cfg.minutos_devolver_bot, 120);
  if (!(minutes > 0)) return false;
  var last = toDate_(c.row.asesor_ultimo) || toDate_(c.row.asesor_desde);
  return !!last && new Date().getTime() - last.getTime() > minutes * 60000;
}

/** Texto honesto sobre cuándo le responden, según el horario. */
function whenHumanReplies_(cfg) {
  var st = openState_(cfg.horario, null, cfg.horario_festivos);
  if (!st || st.open) return 'Ya le aviso a un asesor para que te ayude. Mientras responde, quedo atento 🙌';
  return 'Ya le dejé tu mensaje a un asesor 🙌. Ahora estamos cerrados (' + st.text.replace('Cerrado · ', '') + '), te responde en ese horario.';
}

/**
 * Pasa el chat a una persona: avisa al cliente y a los trabajadores con el contexto.
 * customerText: mensaje para el cliente ('' = el estándar según horario; null = no escribirle).
 */
function startHandoff_(from, c, cfg, reason, customerText, lastText) {
  var already = c.row.asesor === 'pendiente';
  c.row.asesor = c.row.asesor || 'pendiente';
  if (!already) {
    c.row.asesor_desde = new Date();
    c.row.asesor_ultimo = '';
  }
  c.row.asesor_motivo = reason;
  c.data.escalado = '';
  saveClient_(c);
  bumpMetric_('asesor');
  audit_('bot', from, 'asesor', reason);
  if (customerText !== null) waText_(from, customerText || whenHumanReplies_(cfg));
  if (already) return;

  var turns = (c.data.turnos || []).slice(-4).map(function (t) { return (t.r === 'c' ? '👤 ' : '🤖 ') + cut_(t.t, 120); });
  var lastTurn = (c.data.turnos || []).slice(-1)[0];
  if (lastText && !(lastTurn && lastTurn.t === clip_(redact_(lastText), 200))) turns.push('👤 ' + cut_(redact_(lastText), 200));
  var cart = (c.data.carrito || []).length ? priceItems_(c.data.carrito).lines : [];
  var body = '🙋 *Cliente para atender*\n' +
    (c.row.nombre || c.data.perfil || 'Sin nombre') + ' · +' + waNumber_(from) + '\n' +
    'Motivo: ' + (HANDOFF_REASONS[reason] || reason) +
    (turns.length ? '\n\nÚltimos mensajes:\n' + turns.join('\n') : '') +
    (cart.length ? '\n\nCarrito:\n' + orderLines_(cart).join('\n') : '') +
    '\n\nRespóndele desde la app de WhatsApp Business. Mientras tanto el bot no le escribe.';
  alertStaff_(body, [
    { id: 'ho:tomar:' + from, title: '🙋 Yo lo atiendo' },
    { id: 'ho:devolver:' + from, title: '🤖 Devolver al bot' }
  ]);
}

/** Un trabajador toma el chat (o respondió desde la app). */
function takeHandoff_(phone, who) {
  var c = loadClient_(phone);
  if (!c.row._row && !c.row.nombre) return null;
  c.row.asesor = who || 'app';
  if (isBlank_(c.row.asesor_desde)) c.row.asesor_desde = new Date();
  c.row.asesor_ultimo = new Date();
  saveClient_(c);
  audit_(who || 'app', phone, 'tomar', '');
  return c;
}

/** Devuelve el chat al bot. notify=true le escribe al cliente (solo dentro de 24 h). */
function releaseHandoff_(phone, who, notify) {
  var c = loadClient_(phone);
  if (!handoffActive_(c)) return false;
  c.row.asesor = '';
  c.row.asesor_desde = '';
  c.row.asesor_ultimo = '';
  c.row.asesor_motivo = '';
  c.data.fallos = 0;
  c.data.escalado = '';
  saveClient_(c);
  audit_(who || 'bot', phone, 'devolver', '');
  if (notify && inWindow_(c)) {
    waButtons_(phone, 'Sigo por aquí si necesitas algo más 😊', [
      { id: 'cat', title: '🛒 Hacer pedido' },
      { id: 'menu', title: '🏠 Menú' }
    ]);
  }
  return true;
}

/** Eco de la app WhatsApp Business (smb_message_echoes): el dueño le escribió a un cliente a mano. */
function handleEcho_(echo) {
  var to = String(echo.to || '');
  if (!to || workerByPhone_(to)) return;
  var c = loadClient_(to);
  if (!c.row.asesor || c.row.asesor === 'pendiente') c.row.asesor = 'app';
  if (isBlank_(c.row.asesor_desde)) c.row.asesor_desde = new Date();
  c.row.asesor_ultimo = new Date();
  saveClient_(c);
}

/** Tarea: si nadie toma un chat, avisa al número de respaldo y le cuenta al cliente (máx. 1 vez cada 10 min). */
function escalateHandoffs_(cfg) {
  var minutes = num_(cfg.minutos_escalar_asesor, 10);
  if (!(minutes > 0)) return;
  var t = table_(SHEETS.CLIENTS);
  var now = new Date().getTime();
  t.rows.forEach(function (r) {
    if (r.asesor !== 'pendiente') return;
    var since = toDate_(r.asesor_desde);
    if (!since || now - since.getTime() < minutes * 60000) return;
    var c = loadClient_(r.telefono);
    if (!c.data.escalado) {
      c.data.escalado = nowStr_();
      saveClient_(c);
      var backup = String(cfg.numero_respaldo || '').replace(/\D/g, '');
      var text = '⏰ *Nadie ha atendido a un cliente* desde hace ' + minutes + ' min.\n' + (c.row.nombre || c.data.perfil || '') +
        ' · +' + waNumber_(r.telefono) + '\nMotivo: ' + (HANDOFF_REASONS[r.asesor_motivo] || r.asesor_motivo);
      if (backup.length >= 7) alertStaff_(text, [{ id: 'ho:tomar:' + r.telefono, title: '🙋 Yo lo atiendo' }], { to: backup });
      else alertStaff_(text, [{ id: 'ho:tomar:' + r.telefono, title: '🙋 Yo lo atiendo' }]);
    }
    var st = openState_(cfg.horario, null, cfg.horario_festivos);
    if (st && st.open && inWindow_(c) && onceEvery_('cola_' + r.telefono, 600)) {
      waText_(r.telefono, 'Sigues en la fila 🙏, ya casi te atiende una persona. Gracias por la paciencia.');
    }
  });
}

/** ¿Estamos dentro de las 24 h desde el último mensaje del cliente? (regla de WhatsApp) */
function inWindow_(c) {
  var last = toDate_(c.row.ultimo_mensaje);
  return !!last && new Date().getTime() - last.getTime() < 24 * 3600000 - 5 * 60000;
}

/** Chats esperando o atendidos por personas (para el comando "asesor"). */
function handoffList_() {
  return table_(SHEETS.CLIENTS).rows.filter(function (r) { return !isBlank_(r.asesor); }).map(function (r) {
    return (r.asesor === 'pendiente' ? '🕒 ' : '🙋 ') + (r.nombre || '') + ' +' + waNumber_(r.telefono) + ' · ' +
      (r.asesor === 'pendiente' ? 'esperando' : 'con ' + r.asesor) + ' · ' + (HANDOFF_REASONS[r.asesor_motivo] || r.asesor_motivo || '');
  });
}
