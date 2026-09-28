/**
 * Envío de mensajes por la API de WhatsApp Cloud (Meta).
 *
 * Datos secretos en Propiedades del script (Configuración del proyecto →
 * Propiedades del script), nunca en la hoja:
 *   WA_TOKEN        token permanente de un usuario del sistema de Meta
 *   WA_PHONE_ID     identificador del número de teléfono (no el número)
 *   WA_CATALOG_ID   identificador del catálogo de Commerce Manager
 *   RELAY_SECRET    clave compartida con el relé de Cloudflare (relay/)
 */

var GRAPH_URL = 'https://graph.facebook.com/v23.0/';

// Límites de WhatsApp para mensajes interactivos.
var WA_MAX_BUTTONS = 3;
var WA_BUTTON_CHARS = 20;
var WA_LIST_ROWS = 10;
var WA_ROW_TITLE_CHARS = 24;
var WA_ROW_DESC_CHARS = 72;
var WA_BODY_CHARS = 1024;
var WA_TEXT_CHARS = 4096;
var WA_PRODUCTS_PER_MESSAGE = 30;

function secret_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

/** Llamada a la API Graph. Devuelve { ok, status, body }; nunca lanza por errores de Meta. */
function graph_(path, payload, method) {
  var token = secret_('WA_TOKEN');
  if (!token) return { ok: false, status: 0, body: { error: { message: 'Falta WA_TOKEN' } } };
  var res = UrlFetchApp.fetch(GRAPH_URL + path, {
    method: method || 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true
  });
  var status = res.getResponseCode();
  var body;
  try { body = JSON.parse(res.getContentText() || '{}'); } catch (e) { body = {}; }
  if (status >= 300) console.warn('WhatsApp API ' + status + ': ' + JSON.stringify(body).slice(0, 500));
  return { ok: status < 300, status: status, body: body };
}

function waSend_(to, message) {
  var payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(to) };
  Object.keys(message).forEach(function (k) { payload[k] = message[k]; });
  return graph_(secret_('WA_PHONE_ID') + '/messages', payload);
}

function cut_(s, max) {
  s = String(s === undefined || s === null ? '' : s);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function waText_(to, text) {
  return waSend_(to, { type: 'text', text: { body: cut_(text, WA_TEXT_CHARS), preview_url: false } });
}

/** Hasta 3 botones: [{ id, title }]. */
function waButtons_(to, body, buttons, footer) {
  var msg = {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: cut_(body, WA_BODY_CHARS) },
      action: {
        buttons: buttons.slice(0, WA_MAX_BUTTONS).map(function (b) {
          return { type: 'reply', reply: { id: b.id, title: cut_(b.title, WA_BUTTON_CHARS) } };
        })
      }
    }
  };
  if (footer) msg.interactive.footer = { text: cut_(footer, 60) };
  return waSend_(to, msg);
}

/** Lista desplegable: rows = [{ id, title, description }] (máximo 10). */
function waList_(to, body, buttonText, rows, sectionTitle) {
  return waSend_(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: cut_(body, WA_BODY_CHARS) },
      action: {
        button: cut_(buttonText, WA_BUTTON_CHARS),
        sections: [{
          title: cut_(sectionTitle || 'Opciones', WA_ROW_TITLE_CHARS),
          rows: rows.slice(0, WA_LIST_ROWS).map(function (r) {
            var row = { id: r.id, title: cut_(r.title, WA_ROW_TITLE_CHARS) };
            if (r.description) row.description = cut_(r.description, WA_ROW_DESC_CHARS);
            return row;
          })
        }]
      }
    }
  });
}

/**
 * Productos del catálogo de Meta, en uno o varios mensajes de hasta 30.
 * El cliente los ve con foto y precio, y los agrega al carrito de WhatsApp.
 */
function waProducts_(to, header, body, ids) {
  var catalogId = secret_('WA_CATALOG_ID');
  var results = [];
  for (var i = 0; i < ids.length; i += WA_PRODUCTS_PER_MESSAGE) {
    var chunk = ids.slice(i, i + WA_PRODUCTS_PER_MESSAGE);
    var part = ids.length > WA_PRODUCTS_PER_MESSAGE
      ? ' (' + (i / WA_PRODUCTS_PER_MESSAGE + 1) + '/' + Math.ceil(ids.length / WA_PRODUCTS_PER_MESSAGE) + ')'
      : '';
    results.push(waSend_(to, {
      type: 'interactive',
      interactive: {
        type: 'product_list',
        header: { type: 'text', text: cut_(header + part, 60) },
        body: { text: cut_(body, WA_BODY_CHARS) },
        action: {
          catalog_id: catalogId,
          sections: [{
            title: cut_(header, WA_ROW_TITLE_CHARS),
            product_items: chunk.map(function (id) { return { product_retailer_id: id }; })
          }]
        }
      }
    }));
  }
  return results;
}

/** Botón "Ver catálogo" con todo el catálogo. */
function waCatalog_(to, body, thumbnailId) {
  var action = { name: 'catalog_message' };
  if (thumbnailId) action.parameters = { thumbnail_product_retailer_id: thumbnailId };
  return waSend_(to, {
    type: 'interactive',
    interactive: { type: 'catalog_message', body: { text: cut_(body, WA_BODY_CHARS) }, action: action }
  });
}

/** Plantilla aprobada por Meta (para escribir fuera de la ventana de 24 horas). */
function waTemplate_(to, name, params, lang) {
  return waSend_(to, {
    type: 'template',
    template: {
      name: name,
      language: { code: lang || 'es' },
      components: params && params.length
        ? [{ type: 'body', parameters: params.map(function (p) { return { type: 'text', text: cut_(p, 1000) }; }) }]
        : []
    }
  });
}

function waMarkRead_(messageId) {
  return graph_(secret_('WA_PHONE_ID') + '/messages', {
    messaging_product: 'whatsapp', status: 'read', message_id: messageId
  });
}

/** Error 131047: pasaron más de 24 horas desde el último mensaje de esa persona. */
function waNeedsTemplate_(res) {
  var err = res && res.body && res.body.error;
  return !!err && err.code === 131047;
}
