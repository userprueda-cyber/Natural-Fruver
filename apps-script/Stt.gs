/**
 * Notas de voz → texto (opcional, Config audio_activo = si).
 * Proveedor: Deepgram (clave DEEPGRAM_API_KEY en Propiedades del script), ~US$0,0043 por minuto.
 * El audio nunca se guarda: se descarga de Meta, se transcribe y se descarta.
 * La transcripción se le muestra al cliente ("Entendí: …") antes de usarla para un pedido.
 */

var STT_MAX_BYTES = 1024 * 1024; // ~60 s de audio de WhatsApp (opus)
var STT_USD_PER_MIN = 0.0043;

/** { ok, text, confidence, reason } */
function transcribeAudio_(cfg, phone, mediaId) {
  if (!truthy_(cfg.audio_activo)) return { ok: false, reason: 'desactivado' };
  var key = secret_('DEEPGRAM_API_KEY');
  if (!key) return { ok: false, reason: 'sin_clave' };
  var cache = CacheService.getScriptCache();
  var dayKey = 'stt_' + phone + '_' + todayStr_();
  if (num_(cache.get(dayKey), 0) >= num_(cfg.audio_max_dia, 5)) return { ok: false, reason: 'limite' };

  var meta = graph_(encodeURIComponent(mediaId), null, 'get');
  if (!meta.ok || !meta.body.url) return { ok: false, reason: 'descarga' };
  if (num_(meta.body.file_size, 0) > STT_MAX_BYTES) return { ok: false, reason: 'largo' };
  var file = UrlFetchApp.fetch(meta.body.url, { headers: { Authorization: 'Bearer ' + secret_('WA_TOKEN') }, muteHttpExceptions: true });
  if (file.getResponseCode() >= 300) return { ok: false, reason: 'descarga' };
  var bytes = file.getContent();
  if (bytes.length > STT_MAX_BYTES) return { ok: false, reason: 'largo' };
  cache.put(dayKey, String(num_(cache.get(dayKey), 0) + 1), 86400);

  var res = UrlFetchApp.fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=es&smart_format=true', {
    method: 'post',
    contentType: meta.body.mime_type || 'audio/ogg',
    headers: { Authorization: 'Token ' + key },
    payload: bytes,
    muteHttpExceptions: true
  });
  var body;
  try { body = JSON.parse(res.getContentText() || '{}'); } catch (e) { body = {}; }
  if (res.getResponseCode() >= 300) return { ok: false, reason: 'error' };
  var alt = (((((body.results || {}).channels || [])[0] || {}).alternatives || [])[0]) || {};
  var seconds = num_((body.metadata || {}).duration, 0);
  var cost = seconds / 60 * STT_USD_PER_MIN;
  var props = PropertiesService.getScriptProperties();
  ['ia_usd_d_' + todayStr_(), 'ia_usd_m_' + monthKey_()].forEach(function (k) {
    props.setProperty(k, String(num_(props.getProperty(k), 0) + cost));
  });
  appendLog_(SHEETS.USAGE, { fecha: nowStr_(), cliente: last4_(phone), funcion: 'audio', modelo: 'deepgram:nova-2', entrada: Math.round(seconds), salida: 0, costo_usd: Math.round(cost * 1e6) / 1e6 });
  var text = String(alt.transcript || '').trim();
  if (!text) return { ok: false, reason: 'vacio' };
  return { ok: true, text: text, confidence: num_(alt.confidence, 0) };
}
