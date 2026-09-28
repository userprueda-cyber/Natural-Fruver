/**
 * Protecciones antes de procesar un mensaje (capa 0, gratis):
 * pausa general, números bloqueados, exceso de mensajes, bots en bucle y groserías.
 */

function isPaused_(cfg) {
  return truthy_(cfg.bot_pausado) || truthy_(secret_('BOT_PAUSED'));
}

function setPaused_(on, who) {
  var t = table_(SHEETS.CONFIG);
  var row = t.rows.filter(function (r) { return String(r.clave).trim() === 'bot_pausado'; })[0];
  if (row) setCell_(t, row, 'valor', on ? 'si' : 'no');
  else writeRow_(t, { clave: 'bot_pausado', valor: on ? 'si' : 'no', nota: '' });
  audit_(who, '', on ? 'pausar' : 'reanudar', '');
}

/**
 * Límite de mensajes por minuto por número.
 * Devuelve '' (normal), 'warn' (avisar una vez) o 'drop' (ignorar).
 */
function rateLimit_(phone, cfg) {
  var max = num_(cfg.mensajes_por_minuto, 20);
  if (!(max > 0)) return '';
  var cache = CacheService.getScriptCache();
  var key = 'rl_' + phone + '_' + nowStr_().slice(0, 16);
  var n = num_(cache.get(key), 0) + 1;
  cache.put(key, String(n), 120);
  if (n <= max) return '';
  if (n === max + 1) {
    var strikesKey = 'rl_strikes_' + phone + '_' + todayStr_();
    var strikes = num_(cache.get(strikesKey), 0) + 1;
    cache.put(strikesKey, String(strikes), 86400);
    if (strikes >= 3) return 'block';
    return 'warn';
  }
  return 'drop';
}

/** Detecta respuestas automáticas en bucle (el mismo texto muchas veces seguidas). */
function botLoop_(phone, norm) {
  if (!norm) return false;
  var cache = CacheService.getScriptCache();
  var key = 'loop_' + phone;
  var prev = cache.get(key);
  var state = prev ? JSON.parse(prev) : { t: '', n: 0 };
  state = state.t === norm ? { t: norm, n: state.n + 1 } : { t: norm, n: 1 };
  cache.put(key, JSON.stringify(state), 600);
  return state.n >= 4;
}

/** Cuenta groserías/acoso: la primera vez se pone un límite, después silencio y aviso al dueño. */
function abuseStrike_(phone) {
  var cache = CacheService.getScriptCache();
  var key = 'abuso_' + phone + '_' + todayStr_();
  var n = num_(cache.get(key), 0) + 1;
  cache.put(key, String(n), 86400);
  return n;
}

/** Bloquea o desbloquea un número (lista visible en la pestaña Clientes, columna bloqueado). */
function setBlocked_(phone, value, who) {
  var c = loadClient_(phone);
  c.row.bloqueado = value || '';
  saveClient_(c);
  audit_(who || 'bot', phone, value ? 'bloquear' : 'desbloquear', value || '');
}

/** Una vez cada N horas (para no repetir avisos). */
function onceEvery_(key, seconds) {
  var cache = CacheService.getScriptCache();
  if (cache.get(key)) return false;
  cache.put(key, '1', seconds);
  return true;
}
