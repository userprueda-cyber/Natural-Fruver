/**
 * Festivos de Colombia (Ley 51 de 1983, "Ley Emiliani"): fijos, trasladados al
 * lunes siguiente, y los que dependen de la Pascua. Todo en fechas locales.
 */

/** Domingo de Pascua (algoritmo de Meeus/Butcher) → { m, d } */
function easter_(y) {
  var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  var month = Math.floor((h + l - 7 * m + 114) / 31);
  var day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}

function ymd_(date) {
  return date.getUTCFullYear() + '-' + pad2_(date.getUTCMonth() + 1) + '-' + pad2_(date.getUTCDate());
}

function nextMonday_(date) {
  var out = new Date(date.getTime());
  while (out.getUTCDay() !== 1) out.setUTCDate(out.getUTCDate() + 1);
  return out;
}

/** Lista de festivos del año como 'yyyy-MM-dd'. */
function colombianHolidays_(y) {
  var utc = function (m, d) { return new Date(Date.UTC(y, m - 1, d)); };
  var list = [];
  // Fijos (no se trasladan)
  [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]].forEach(function (x) { list.push(utc(x[0], x[1])); });
  // Se trasladan al lunes
  [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]].forEach(function (x) { list.push(nextMonday_(utc(x[0], x[1]))); });
  // Según la Pascua
  var e = easter_(y);
  var easter = utc(e.m, e.d);
  var plus = function (days) { return new Date(easter.getTime() + days * 86400000); };
  list.push(plus(-3)); // Jueves Santo
  list.push(plus(-2)); // Viernes Santo
  list.push(nextMonday_(plus(39))); // Ascensión
  list.push(nextMonday_(plus(60))); // Corpus Christi
  list.push(nextMonday_(plus(68))); // Sagrado Corazón
  return list.map(ymd_).sort();
}

/** true si la fecha local 'yyyy-MM-dd' es festivo en Colombia. */
function isHoliday_(dateStr) {
  var y = Number(String(dateStr).slice(0, 4));
  return colombianHolidays_(y).indexOf(String(dateStr).slice(0, 10)) >= 0;
}
