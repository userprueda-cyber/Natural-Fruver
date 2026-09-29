/**
 * Horario de la tienda (Config: horario), igual que lo entendía la página:
 * "lun-vie 08:30-18:00; sab-dom 08:30-16:00".
 */

var DAY_KEYS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
var DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Texto → { díaDeLaSemana: [[minInicio, minFin], ...] } (0 = domingo). */
function parseHours_(text) {
  var out = {};
  String(text || '').split(/[;\n]/).forEach(function (seg) {
    seg = normalize_(seg.replace(/(\d)\s*:\s*(\d)/g, '$1h$2').replace(/-/g, ' a '))
      .replace(/(\d+)h(\d+)/g, '$1:$2');
    var m = seg.match(/^([a-z][a-z\s]*?)\s*(\d.*)$/);
    if (!m) return;
    var days = parseDays_(m[1]);
    var ranges = [];
    var re = /(\d{1,2})(?::(\d{2}))?\s*a\s*(\d{1,2})(?::(\d{2}))?/g;
    var r;
    while ((r = re.exec(m[2]))) {
      ranges.push([Number(r[1]) * 60 + Number(r[2] || 0), Number(r[3]) * 60 + Number(r[4] || 0)]);
    }
    days.forEach(function (d) { out[d] = (out[d] || []).concat(ranges); });
  });
  return out;
}

/** "lun a sab" → [1..6]; "lun mie y vie" → [1, 3, 5]; "sab a lun" → [6, 0, 1] */
function parseDays_(text) {
  var days = [];
  var words = text.split(/\s+/).filter(function (w) { return w && w !== 'y'; });
  for (var i = 0; i < words.length; i++) {
    var d = DAY_KEYS.indexOf(words[i].slice(0, 3));
    if (d < 0) continue;
    if (words[i + 1] === 'a' && words[i + 2] && DAY_KEYS.indexOf(words[i + 2].slice(0, 3)) >= 0) {
      var end = DAY_KEYS.indexOf(words[i + 2].slice(0, 3));
      for (var x = d; ; x = (x + 1) % 7) { days.push(x); if (x === end) break; }
      i += 2;
    } else {
      days.push(d);
    }
  }
  return days;
}

function localNow_(date) {
  var s = Utilities.formatDate(date || new Date(), tz_(), 'yyyy-MM-dd HH:mm');
  var day = new Date(s.slice(0, 10) + 'T12:00:00Z').getUTCDay();
  return { day: day, min: Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)), date: s.slice(0, 10) };
}

function fmtTime_(min) {
  var h = Math.floor(min / 60) % 24;
  var m = min % 60;
  var h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' a. m.' : ' p. m.');
}

function addDaysStr_(dateStr, n) {
  var d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return ymd_(d);
}

/**
 * Horarios de un día concreto, teniendo en cuenta los festivos.
 * holidayText: Config horario_festivos ("cerrado", "08:30-14:00" o vacío = sin confirmar).
 * Devuelve { ranges, holiday, unknown }.
 */
function rangesForDate_(hours, dateStr, weekday, holidayText) {
  if (!isHoliday_(dateStr)) return { ranges: hours[weekday] || [], holiday: false, unknown: false };
  var h = normalize_(holidayText);
  if (!h) return { ranges: hours[weekday] || [], holiday: true, unknown: true };
  if (h === 'cerrado') return { ranges: [], holiday: true, unknown: false };
  var parsed = parseHours_('lun a dom ' + String(holidayText));
  return { ranges: parsed[weekday] || [], holiday: true, unknown: false };
}

/**
 * { open, text: 'Abierto · cierra 6:00 p. m.', holiday, unknown } o null si no hay horario.
 * holidayText es opcional (Config horario_festivos).
 */
function openState_(hoursText, date, holidayText) {
  var hours = parseHours_(hoursText);
  if (!Object.keys(hours).length) return null;
  var now = localNow_(date);
  var todayInfo = rangesForDate_(hours, now.date, now.day, holidayText);
  var note = todayInfo.unknown ? ' (hoy es festivo: el horario puede cambiar)' : '';
  var today = todayInfo.ranges;
  for (var i = 0; i < today.length; i++) {
    if (now.min >= today[i][0] && now.min < today[i][1]) {
      return { open: true, text: 'Abierto · cierra ' + fmtTime_(today[i][1]) + note, holiday: todayInfo.holiday, unknown: todayInfo.unknown };
    }
  }
  for (var add = 0; add < 8; add++) {
    var d = (now.day + add) % 7;
    var info = add === 0 ? todayInfo : rangesForDate_(hours, addDaysStr_(now.date, add), d, holidayText);
    var ranges = info.ranges.slice().sort(function (a, b) { return a[0] - b[0]; });
    for (var j = 0; j < ranges.length; j++) {
      if (add > 0 || ranges[j][0] > now.min) {
        var when = add === 0 ? 'hoy' : add === 1 ? 'mañana' : 'el ' + DAY_NAMES[d];
        return {
          open: false, text: 'Cerrado · abre ' + when + ' ' + fmtTime_(ranges[j][0]) + (info.unknown ? ' (es festivo: por confirmar)' : note),
          holiday: todayInfo.holiday, unknown: todayInfo.unknown || info.unknown
        };
      }
    }
  }
  return { open: false, text: 'Cerrado', holiday: todayInfo.holiday, unknown: todayInfo.unknown };
}

/** Horario legible, una línea por grupo de días. */
function hoursText_(hoursText) {
  var hours = parseHours_(hoursText);
  var lines = [];
  [1, 2, 3, 4, 5, 6, 0].forEach(function (d) {
    var r = (hours[d] || []).map(function (x) { return fmtTime_(x[0]) + ' – ' + fmtTime_(x[1]); }).join(', ');
    var name = DAY_NAMES[d].charAt(0).toUpperCase() + DAY_NAMES[d].slice(1);
    lines.push(name + ': ' + (r || 'cerrado'));
  });
  return lines.join('\n');
}
