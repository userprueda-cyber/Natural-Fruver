/**
 * Datos personales (Ley 1581 de 2012): aviso y autorización, ver / borrar datos, "baja".
 * No es asesoría legal: el dueño debe revisar la política con un abogado.
 */

var CONSENT_VERSION = 'v1';

/** Texto corto del aviso de datos que va en el primer mensaje. */
function consentNotice_(cfg) {
  var url = String(cfg.url_politica_datos || '').trim();
  return '🔒 Usamos tu nombre, teléfono y dirección solo para atender tus pedidos' + (url ? ' (' + url + ')' : '') +
    '. Al seguir escribiendo lo autorizas. Escribe *mis datos* para verlos o borrarlos.';
}

/** Registra la autorización la primera vez que el cliente sigue después de ver el aviso. */
function recordConsent_(c) {
  if (!isBlank_(c.row.consentimiento) || !c.data.aviso_datos) return false;
  c.row.consentimiento = CONSENT_VERSION + ' ' + nowStr_();
  return true;
}

function sendMyData_(to, c) {
  var orders = table_(SHEETS.ORDERS).rows.filter(function (r) { return samePhone_(r.telefono, to); });
  var lines = [
    '🔒 *Tus datos en Natural Fruver*',
    'Nombre: ' + (c.row.nombre || '(no guardado)'),
    'Dirección: ' + (c.row.direccion || '(no guardada)'),
    'Teléfono: +' + waNumber_(to),
    'Pedidos: ' + orders.length,
    'Autorización: ' + (c.row.consentimiento || 'pendiente'),
    '',
    'Puedes cambiar la dirección escribiendo *cambiar dirección*, o borrar todo.'
  ];
  return waButtons_(to, lines.join('\n'), [
    { id: 'priv:borrar', title: '🗑️ Borrar mis datos' },
    { id: 'priv:dir', title: '📍 Cambiar dirección' },
    { id: 'menu', title: '🏠 Menú' }
  ]);
}

function askDeleteData_(to) {
  return waButtons_(to, '¿Seguro que quieres borrar tus datos? Borramos tu nombre, dirección y conversación, y en tus pedidos anteriores quedan anónimos. No se puede deshacer.', [
    { id: 'priv:borrar:ok', title: '✅ Sí, borrar' },
    { id: 'menu', title: '❌ No' }
  ]);
}

/**
 * Borra o anonimiza los datos del cliente. Pedidos abiertos no se tocan (los atiende una persona).
 * Devuelve { ok, abiertos }.
 */
function deleteCustomerData_(phone, who) {
  var ordersT = table_(SHEETS.ORDERS);
  var mine = ordersT.rows.filter(function (r) { return samePhone_(r.telefono, phone); });
  var open = mine.filter(function (r) { return FINAL_STATES.indexOf(String(r.estado)) < 0; });
  if (open.length) return { ok: false, abiertos: open.map(function (r) { return r.nro; }) };
  var masked = '***' + String(phone).replace(/\D/g, '').slice(-4);
  mine.forEach(function (r) {
    setCell_(ordersT, r, 'cliente', '[eliminado]');
    setCell_(ordersT, r, 'direccion', r.direccion ? '[eliminado]' : '');
    setCell_(ordersT, r, 'notas', '');
    setCell_(ordersT, r, 'telefono', masked);
  });
  var c = loadClient_(phone);
  var keepOptout = c.row.baja;
  var t = c.t;
  t.headers.forEach(function (h) { c.row[h] = ''; });
  if (keepOptout) { c.row.telefono = phone; c.row.baja = keepOptout; } // recordar la "baja" (solo el número)
  if (c.row._row) writeRow_(t, c.row);
  audit_(who || 'cliente', phone, 'borrar_datos', mine.length + ' pedidos anonimizados');
  return { ok: true, pedidos: mine.length };
}

function setOptOut_(c, on) {
  c.row.baja = on ? nowStr_() : '';
  saveClient_(c);
  audit_('cliente', c.row.telefono, on ? 'baja' : 'alta', '');
}
