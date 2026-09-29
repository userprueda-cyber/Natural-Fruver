/* Natural Fruver — utilidades compartidas por la tienda y la página de trabajadores. */
(function (root) {
  'use strict';

  var cfg = (root && root.NF_CONFIG) || {};
  var TZ = 'America/Bogota';
  var DAYS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
  var DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var UNIT_LABELS = { unidad: 'und', kg: 'kg', lb: 'lb', atado: 'atado', canasta: 'canasta', paquete: 'paq', bandeja: 'bandeja' };

  // ---------- API ----------

  function apiUrl() {
    return String(cfg.API_URL || '').trim();
  }

  function isDemo() {
    return !apiUrl();
  }

  function getCatalog() {
    var url = isDemo() ? 'data/demo-catalogo.json' : apiUrl() + '?action=catalogo&t=' + Date.now();
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // text/plain evita el "preflight" CORS que Apps Script no admite.
  function post(body) {
    if (isDemo()) return Promise.reject(new Error('demo'));
    return fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ---------- Formato ----------

  var moneyFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

  function money(n) {
    return moneyFmt.format(Math.round(Number(n) || 0)).replace(/\s/g, ' ');
  }

  function qty(n) {
    return String(Math.round(Number(n) * 100) / 100).replace('.', ',');
  }

  function unitLabel(u) {
    return UNIT_LABELS[u] || u || 'und';
  }

  function isDecimalUnit(u) {
    return u === 'kg' || u === 'lb';
  }

  function step(u) {
    return isDecimalUnit(u) ? 0.5 : 1;
  }

  function priceOf(p) {
    return p.oferta != null ? p.oferta : p.precio;
  }

  function discountPct(p) {
    if (p.oferta == null || !p.precio) return 0;
    return Math.round((1 - p.oferta / p.precio) * 100);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Búsqueda (sin tildes, tolera errores de una letra) ----------

  function normalize(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /** Distancia de edición contando el intercambio de dos letras vecinas como 1 ("mnago" → "mango"). */
  function lev(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var d = [];
    for (var i = 0; i <= a.length; i++) {
      d[i] = [i];
      for (var j = 1; j <= b.length; j++) {
        if (i === 0) { d[i][j] = j; continue; }
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }

  /** Puntaje de una palabra buscada: { s: puntaje, fuzzy: true si solo coincide con error de letra }. */
  function tokenScore(token, nameWords, otherWords) {
    var best = { s: 0, fuzzy: false };
    function check(words, weight) {
      words.forEach(function (w) {
        var s = 0;
        var fuzzy = false;
        if (w === token) s = 10;
        else if (w.indexOf(token) === 0) s = 8;
        else if (token.length >= 3 && w.indexOf(token) > 0) s = 5;
        else if (token.length >= 4) {
          var allowed = token.length >= 7 ? 2 : 1;
          if (lev(token, w) <= allowed || lev(token, w.slice(0, token.length)) <= allowed) {
            s = 4;
            fuzzy = true;
          }
        }
        if (s * weight > best.s) best = { s: s * weight, fuzzy: fuzzy };
      });
    }
    check(nameWords, 1);
    check(otherWords, 0.6);
    return best;
  }

  /** Devuelve los productos que coinciden con la búsqueda, los mejores primero. */
  function search(products, query) {
    var tokens = normalize(query).split(' ').filter(Boolean);
    if (!tokens.length) return products.slice();
    var scored = [];
    products.forEach(function (p, idx) {
      var nameWords = normalize(p.nombre).split(' ');
      var otherWords = normalize(p.categoria + ' ' + (p.palabras || '')).split(' ').filter(Boolean);
      var total = 0;
      var fuzzy = false;
      for (var i = 0; i < tokens.length; i++) {
        var t = tokenScore(tokens[i], nameWords, otherWords);
        if (!t.s) return;
        if (t.fuzzy) fuzzy = true;
        total += t.s;
      }
      if (p.disponible) total += 0.5;
      scored.push({ p: p, s: total, i: idx, fuzzy: fuzzy });
    });
    // Si algo coincide de verdad, no mostramos coincidencias "por error de letra".
    if (scored.some(function (x) { return !x.fuzzy; })) {
      scored = scored.filter(function (x) { return !x.fuzzy; });
    }
    scored.sort(function (a, b) { return (b.s - a.s) || (a.i - b.i); });
    return scored.map(function (x) { return x.p; });
  }

  // ---------- Horario ----------

  /** "lun-sab 07:00-19:00; dom 08:00-13:00" → { 0: [[480, 780]], 1: [[420, 1140]], ... } */
  function parseHours(text) {
    var out = {};
    String(text || '').split(/[;\n]/).forEach(function (seg) {
      seg = seg.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      var m = seg.match(/^([a-z][a-z\s,\-y]*?)\s*(\d.*)$/);
      if (!m) return;
      var days = parseDays(m[1]);
      var ranges = [];
      var re = /(\d{1,2})(?::(\d{2}))?\s*(?:-|a)\s*(\d{1,2})(?::(\d{2}))?/g;
      var r;
      while ((r = re.exec(m[2]))) {
        ranges.push([Number(r[1]) * 60 + Number(r[2] || 0), Number(r[3]) * 60 + Number(r[4] || 0)]);
      }
      days.forEach(function (d) { out[d] = (out[d] || []).concat(ranges); });
    });
    return out;
  }

  /** "lun-sab" → [1..6]; "lun, mie y vie" → [1, 3, 5]; "sab-lun" → [6, 0, 1] */
  function parseDays(text) {
    var days = [];
    text.split(/,|\sy\s/).forEach(function (part) {
      var ends = part.split('-').map(function (w) { return DAYS.indexOf(w.trim().slice(0, 3)); });
      if (ends.length === 2 && ends[0] >= 0 && ends[1] >= 0) {
        for (var d = ends[0]; ; d = (d + 1) % 7) {
          days.push(d);
          if (d === ends[1]) break;
        }
      } else if (ends.length === 1 && ends[0] >= 0) {
        days.push(ends[0]);
      }
    });
    return days;
  }

  function bogotaNow(date) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date || new Date()).forEach(function (p) { parts[p.type] = p.value; });
    var day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    return { day: day, min: Number(parts.hour) * 60 + Number(parts.minute) };
  }

  function fmtTime(min) {
    var h = Math.floor(min / 60) % 24;
    var m = min % 60;
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' a. m.' : ' p. m.');
  }

  /** { open: bool, text: 'Abierto · cierra 7:00 p. m.' } o null si no hay horario. */
  function openState(hoursText, date) {
    var hours = parseHours(hoursText);
    if (!Object.keys(hours).length) return null;
    var now = bogotaNow(date);
    var today = hours[now.day] || [];
    for (var i = 0; i < today.length; i++) {
      if (now.min >= today[i][0] && now.min < today[i][1]) {
        return { open: true, text: 'Abierto · cierra ' + fmtTime(today[i][1]) };
      }
    }
    for (var add = 0; add < 7; add++) {
      var d = (now.day + add) % 7;
      var ranges = (hours[d] || []).slice().sort(function (a, b) { return a[0] - b[0]; });
      for (var j = 0; j < ranges.length; j++) {
        if (add > 0 || ranges[j][0] > now.min) {
          var when = add === 0 ? 'hoy' : add === 1 ? 'mañana' : 'el ' + DAY_NAMES[d];
          return { open: false, text: 'Cerrado · abre ' + when + ' ' + fmtTime(ranges[j][0]) };
        }
      }
    }
    return { open: false, text: 'Cerrado' };
  }

  // ---------- Emoji de reemplazo mientras no haya foto ----------

  var EMOJI = [
    ['banano guineo', '🍌'], ['mango', '🥭'], ['aguacate palta', '🥑'], ['fresa frutilla', '🍓'],
    ['limon lima', '🍋'], ['naranja mandarina', '🍊'], ['manzana', '🍎'], ['pera', '🍐'], ['uva', '🍇'],
    ['pina', '🍍'], ['sandia patilla', '🍉'], ['melon', '🍈'], ['coco', '🥥'], ['kiwi', '🥝'], ['cereza', '🍒'],
    ['durazno melocoton', '🍑'], ['mora arandano', '🫐'], ['tomate', '🍅'], ['cebolla', '🧅'], ['ajo', '🧄'],
    ['zanahoria', '🥕'], ['lechuga repollo espinaca acelga', '🥬'], ['brocoli coliflor', '🥦'], ['pepino', '🥒'],
    ['pimenton aji', '🫑'], ['maiz mazorca', '🌽'], ['papa', '🥔'], ['yuca', '🍠'], ['platano', '🍌'],
    ['berenjena', '🍆'], ['champinon', '🍄'], ['frijol lenteja garbanzo arveja', '🫘'], ['huevo', '🥚'],
    ['queso', '🧀'], ['leche', '🥛'], ['cilantro perejil hierbabuena albahaca', '🌿'], ['jengibre', '🫚'],
    ['mantequilla', '🧈'], ['yogurt yogur', '🥛'], ['salchicha chorizo salchichon', '🌭'], ['hamburguesa', '🍔'],
    ['chicharron tocineta jamon', '🥓'], ['costilla lomo filete solomito bondiola chuleta chuleton fajitas cubitos ossobuco', '🥩'],
    ['cafe', '☕'], ['arroz', '🍚'], ['cerveza', '🍺'], ['gaseosa', '🥤'], ['helado barquillo', '🍦'],
    ['combo canasta', '🧺']
  ];

  function productEmoji(p, fallback) {
    var words = normalize(p.nombre).split(' ');
    for (var i = 0; i < EMOJI.length; i++) {
      var keys = EMOJI[i][0].split(' ');
      for (var j = 0; j < keys.length; j++) {
        if (words.indexOf(keys[j]) >= 0 || words.indexOf(keys[j] + 's') >= 0 || words.indexOf(keys[j] + 'es') >= 0) return EMOJI[i][1];
      }
    }
    return fallback || '🧺';
  }

  // ---------- WhatsApp ----------

  function orderMessage(order, customer, storeName) {
    var lines = [];
    lines.push('*Pedido ' + order.nro + '* — ' + (storeName || 'Natural Fruver'));
    lines.push('');
    order.lineas.forEach(function (l) {
      lines.push('• ' + qty(l.cantidad) + ' ' + unitLabel(l.unidad) + ' ' + l.nombre + ' — ' + money(l.total));
    });
    lines.push('');
    lines.push('Subtotal: ' + money(order.subtotal));
    if (customer.entrega === 'domicilio') {
      lines.push('Domicilio: ' + (order.domicilio ? money(order.domicilio) : 'gratis'));
    }
    lines.push('*Total: ' + money(order.total) + '*');
    lines.push('');
    lines.push('Nombre: ' + customer.nombre);
    lines.push('Teléfono: ' + customer.telefono);
    lines.push(customer.entrega === 'domicilio' ? 'Entrega: domicilio — ' + customer.direccion : 'Entrega: recojo en la tienda');
    if (customer.notas) lines.push('Notas: ' + customer.notas);
    return lines.join('\n');
  }

  function waLink(number, text) {
    var n = String(number || '').replace(/\D/g, '');
    return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text || '');
  }

  var NF = {
    config: cfg,
    isDemo: isDemo,
    getCatalog: getCatalog,
    post: post,
    money: money,
    qty: qty,
    unitLabel: unitLabel,
    isDecimalUnit: isDecimalUnit,
    step: step,
    priceOf: priceOf,
    discountPct: discountPct,
    escapeHtml: escapeHtml,
    normalize: normalize,
    search: search,
    parseHours: parseHours,
    openState: openState,
    fmtTime: fmtTime,
    productEmoji: productEmoji,
    orderMessage: orderMessage,
    waLink: waLink
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NF;
  else root.NF = NF;
})(typeof window !== 'undefined' ? window : this);
