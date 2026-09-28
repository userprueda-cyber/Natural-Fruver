/**
 * Entender mensajes mal escritos SIN inteligencia artificial (gratis):
 *   1. normalizar  ("kiero 2lbs d tomate xfa" → "quiero 2 lb de tomate por favor")
 *   2. intención   (saludo, pedido, precio, horario, asesor, queja…)
 *   3. productos   (alias + parecido de palabras, con un puntaje de confianza)
 *   4. cantidades  ("libra y media", "medio kilo", "2 y media", "1/2")
 * Solo si esto no alcanza se usa la IA (Llm.gs). Precios y totales nunca salen de aquí.
 */

var NLU_ACCEPT = 0.8;   // desde aquí se acepta el producto sin preguntar
var NLU_MARGIN = 0.08;  // ventaja mínima sobre el segundo candidato
var NLU_ASK = 0.55;     // entre ASK y ACCEPT (o empate) se pregunta con botones

var NLU_ABBREV = {
  q: 'que', xq: 'porque', pq: 'porque', porq: 'porque', xfa: 'por favor', porfa: 'por favor', porfis: 'por favor',
  pf: 'por favor', pls: 'por favor', plis: 'por favor', pa: 'para', pal: 'para el', d: 'de', tmb: 'tambien',
  tb: 'tambien', tbn: 'tambien', bn: 'bien', ps: 'pues', dnd: 'donde', cto: 'cuanto', xa: 'para', toy: 'estoy',
  hla: 'hola', ola: 'hola', olaa: 'hola', bns: 'buenas', bnas: 'buenas', grax: 'gracias', grs: 'gracias', grcs: 'gracias',
  kiero: 'quiero', kero: 'quiero', qiero: 'quiero', nesesito: 'necesito', nececito: 'necesito', nesecito: 'necesito',
  regaleme: 'regalame', regalme: 'regalame', regalem: 'regalame', mandeme: 'mandame', enviame: 'mandame', envieme: 'mandame',
  ai: 'hay', ahi: 'hay', aii: 'hay', tienn: 'tienen', tiene: 'tienen', cuant: 'cuanto', kuanto: 'cuanto', qto: 'cuanto',
  vle: 'vale', xq: 'porque', ud: 'usted', uds: 'ustedes', mañan: 'manana', manana: 'manana', aguacte: 'aguacate',
  ok: 'ok', oki: 'ok', okey: 'ok', okay: 'ok', vale: 'vale', dale: 'dale', sii: 'si', sip: 'si', nop: 'no', nel: 'no'
};
// "x" es "por" salvo entre números ("2 x 30"); "k" es "que" salvo después de un número ("2 k" = 2 kilos).
var NLU_NUMBER_WORDS = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50,
  media: 0.5, medio: 0.5, cuarto: 0.25, cuartico: 0.25, docena: 12
};
var NLU_STOP = ('de del la las el los un una unos unas y o con para por favor me mi mis nos le les lo al a en ' +
  'regala regalame regalas regale manda mandame mandar mande envia enviar quiero quisiera queria necesito ' +
  'deme dame dar vende venden vendes venta hay tienen tiene tienes manejan manejas precio cuanto vale ' +
  'cuesta sale esta estan como que pedido pedir hacer agregar agrega agregue agregame pon ponme pongame ' +
  'anota anotame apunta apunteme tambien mas otro otra otros otras buenas buenos hola dias tardes noches ' +
  'porfa gracias si no bien kilo poquito poquitico poco algo cuantos cuantas varios varias porque pues ya ahora hoy mañana manana este esta esa ese eso solo cada ' +
  'bueno buena aprox aproximadamente sumerce veci vecino vecina amigo amiga senor senora don dona').split(' ');

// ───────────────────────── 1. Normalizar ─────────────────────────

/** Minúsculas, sin tildes, letras repetidas, abreviaturas y números escritos en palabras. */
function normText_(s) {
  var t = String(s || '').normalize('NFKC');
  t = t.replace(/(\d)\s*\/\s*(\d)/g, '$1/$2');
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/ñ/g, 'n');
  t = t.replace(/(\d),(\d)/g, '$1.$2');                 // 1,5 → 1.5
  t = t.replace(/[,;]+/g, ' , ').replace(/[^a-z0-9.,/#\-\s]+/g, ' ');
  t = t.replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2'); // 2lbs → 2 lbs
  t = t.replace(/([a-z])\1{2,}/g, '$1');               // holaaa → hola
  t = t.replace(/([a-z]{3,})ss\b/g, '$1s');             // aguacatess → aguacates
  var words = t.split(/\s+/).filter(Boolean);
  var out = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    var prevNum = i > 0 && /^[\d.\/]+$/.test(words[i - 1]);
    if (w === 'x' && !(prevNum && /^\d/.test(words[i + 1] || ''))) w = 'por';
    else if (w === 'k' && !prevNum) w = 'que';
    else if (NLU_ABBREV[w]) w = NLU_ABBREV[w];
    out.push(w);
  }
  t = ' ' + out.join(' ') + ' ';
  t = t.replace(/ (\d+)\/(\d+) /g, function (m, a, b) { return ' ' + (Number(b) ? Number(a) / Number(b) : a) + ' '; });
  // Fracciones con unidad: "libra y media", "2 libras y media", "kilo y medio", "2 y media"
  t = t.replace(/ (\d+(?:\.\d+)?) ([a-z]+) y (media|medio) /g, function (m, n, u) { return ' ' + (Number(n) + 0.5) + ' ' + u + ' '; });
  t = t.replace(/ (un |una )?(libra|kilo|lb|kg) y (media|medio) /g, function (m, a, u) { return ' 1.5 ' + u + ' '; });
  t = t.replace(/ (\d+) y (media|medio) /g, function (m, n) { return ' ' + (Number(n) + 0.5) + ' '; });
  t = t.replace(/ (un|una) (cuarto|cuartico) (de )?/g, ' 0.25 ');
  t = t.replace(/ (media|medio) (docena) /g, ' 6 ');
  t = t.replace(/ (\w+)(?= )/g, function (m, w) { return NLU_NUMBER_WORDS.hasOwnProperty(w) ? ' ' + NLU_NUMBER_WORDS[w] : m; });
  // "1 docena" → 12
  t = t.replace(/ (\d+(?:\.\d+)?) 12 /g, function (m, n) { return ' ' + Number(n) * 12 + ' '; });
  return t.replace(/\s+/g, ' ').trim();
}

/** Plural simple: "tomates" → "tomate", "limones" → "limon", "papas" → "papa". */
function stem_(w) {
  if (w.length > 4 && /ones$/.test(w)) return w.slice(0, -2);
  if (w.length > 4 && /[^aeiou]es$/.test(w) && !/(ces)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && /s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Distancia de Damerau-Levenshtein (con transposiciones). */
function editDistance_(a, b) {
  var n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  var d = [];
  for (var i = 0; i <= n; i++) { d[i] = [i]; }
  for (var j = 0; j <= m; j++) d[0][j] = j;
  for (i = 1; i <= n; i++) {
    for (j = 1; j <= m; j++) {
      var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[n][m];
}

/** Parecido entre dos palabras (0–1), tolerante a errores de digitación. */
function wordSim_(a, b) {
  if (a === b) return 1;
  a = stem_(a); b = stem_(b);
  if (a === b) return 1;
  var len = Math.max(a.length, b.length);
  if (Math.min(a.length, b.length) < 5) return 0;
  var dist = editDistance_(a, b);
  var allowed = len >= 8 ? 2 : 1;
  if (dist > allowed) return 0;
  return 1 - dist / (len + 2);
}

// ───────────────────────── Unidades ─────────────────────────

/** { lb: {unit:'lb', grams:500}, libras: {...}, ... } desde la pestaña Unidades (o valores por defecto). */
function unitTable_() {
  var rows;
  try {
    rows = ss_().getSheetByName(SHEETS.UNITS) ? table_(SHEETS.UNITS).rows : [];
  } catch (e) { rows = []; }
  if (!rows.length) rows = DEFAULT_UNITS.map(function (u) { return { unidad: u[0], sinonimos: u[1], gramos: u[2] }; });
  var map = {};
  rows.forEach(function (r) {
    var unit = normalize_(r.unidad);
    if (!unit) return;
    var grams = num_(r.gramos, 0) || null;
    map[unit] = { unit: unit, grams: grams };
    String(r.sinonimos || '').split(',').forEach(function (s) {
      var k = normalize_(s);
      if (k) map[k] = { unit: unit, grams: grams };
    });
  });
  return map;
}

// ───────────────────────── Índice de productos ─────────────────────────

function significant_(words) {
  return words.filter(function (w) { return w && NLU_STOP.indexOf(w) < 0 && !/^\d+(\.\d+)?$/.test(w); });
}

/** Productos no archivados con sus frases (nombre, alias) y palabras clave, ya normalizados. */
function productIndex_() {
  var today = todayStr_();
  var vocab = {};
  var list = table_(SHEETS.PRODUCTS).rows.filter(function (p) {
    return !isBlank_(p.id) && !isBlank_(p.nombre) && !truthy_(p.archivado);
  }).map(function (p) {
    var pub = publicProduct_(p, today);
    var phrases = [normalize_(p.nombre)].concat(String(p.alias || '').split(',').map(normalize_)).filter(Boolean);
    var keywords = normalize_(p.palabras_clave).split(' ').filter(Boolean);
    phrases.forEach(function (ph) { ph.split(' ').forEach(function (w) { vocab[stem_(w)] = true; }); });
    keywords.forEach(function (w) { vocab[stem_(w)] = true; });
    return {
      id: String(p.id).trim(), p: pub, row: p,
      phrases: phrases.map(function (ph) { return significant_(ph.split(' ')); }).filter(function (x) { return x.length; }),
      keywords: significant_(keywords),
      visible: pub.disponible && (isBlank_(p.en_whatsapp) || truthy_(p.en_whatsapp))
    };
  });
  return { list: list, vocab: vocab };
}

/** ¿La palabra se parece a alguna del catálogo? */
function inVocab_(w, index) {
  var s = stem_(w);
  if (index.vocab[s]) return true;
  if (s.length < 5) return false;
  for (var v in index.vocab) { if (wordSim_(s, v) > 0) return true; }
  return false;
}

function phraseScore_(q, phrase) {
  var qSum = 0;
  var used = {};
  q.forEach(function (qw) {
    var best = 0, bestJ = -1;
    phrase.forEach(function (pw, j) {
      var s = wordSim_(qw, pw);
      if (s > best) { best = s; bestJ = j; }
    });
    qSum += best;
    if (bestJ >= 0 && best > 0) used[bestJ] = true;
  });
  var cq = qSum / q.length;
  var cp = Object.keys(used).length / phrase.length;
  return 0.7 * cq + 0.3 * cp;
}

/**
 * Candidatos para un texto de producto: [{ id, p, score, visible }] ordenados.
 * Las palabras que no están en el catálogo ("maduros", "bonitos") se ignoran.
 */
function matchProducts_(text, index) {
  index = index || productIndex_();
  var words = significant_(normText_(text).split(' '));
  var q = words.filter(function (w) { return inVocab_(w, index); });
  if (!q.length) return { candidates: [], extra: words, known: [] };
  var scored = index.list.map(function (it) {
    var best = 0;
    it.phrases.forEach(function (ph) { best = Math.max(best, phraseScore_(q, ph)); });
    if (it.keywords.length) best = Math.max(best, 0.9 * phraseScore_(q, it.keywords) - 0.15);
    return { id: it.id, p: it.p, row: it.row, score: Math.round(best * 1000) / 1000, visible: it.visible };
  }).filter(function (x) { return x.score > 0.3; });
  scored.sort(function (a, b) { return (b.score - a.score) || (a.p.orden - b.p.orden); });
  var extra = words.filter(function (w) { return q.indexOf(w) < 0; });
  return { candidates: scored.slice(0, 8), extra: extra, known: q };
}

/**
 * Decide con los candidatos: { status: 'ok'|'ask'|'none', product, options }.
 * 'ask' cuando hay empate o la confianza es media: se pregunta con botones.
 */
function resolveProduct_(match) {
  var c = match.candidates;
  if (!c.length || c[0].score < NLU_ASK) {
    return { status: 'none', options: c.filter(function (x) { return x.score >= 0.4; }).slice(0, 3) };
  }
  var top = c[0];
  var close = c.filter(function (x) { return top.score - x.score < NLU_MARGIN; });
  if (top.score >= NLU_ACCEPT && close.length === 1) return { status: 'ok', product: top, confidence: top.score };
  return { status: 'ask', options: (close.length > 1 ? close : c.filter(function (x) { return x.score >= NLU_ASK; })).slice(0, 9) };
}

// ───────────────────────── Cantidades ─────────────────────────

/** Convierte cantidad+unidad del cliente a la unidad del producto. { qty, ok, reason } */
function convertQty_(qty, unit, productUnit, units) {
  var pu = normalize_(productUnit || 'unidad');
  if (!unit || unit === pu) return { qty: qty, ok: true };
  var from = units[unit], to = units[pu];
  if (from && to && from.grams && to.grams) return { qty: qty * from.grams / to.grams, ok: true };
  return { qty: qty, ok: false, reason: 'unidad' };
}

/** Paso de venta por unidad: kg en cuartos, lb en medias, lo demás en enteros. */
function qtyStep_(unidad) {
  var u = String(unidad || '').toLowerCase();
  return u === 'kg' ? 0.25 : u === 'lb' ? 0.5 : 1;
}

// ───────────────────────── Intenciones ─────────────────────────

var INTENT_RULES = [
  ['optout', /\b(stop|baja|darme de baja|no (me )?(manden|envien|escriban) mas|no mas mensajes|unsubscribe)\b/],
  ['injection', /(ignor|olvid)\w* (todas |todo |tus |las |sus |lo )*(instrucciones|reglas|indicaciones|anterior|que te dijeron)|\d{2,3} ?(%|por ciento) de descuento|system prompt|prompt del sistema|(muestra|dime|revela)\w* (tu|el|tus) (prompt|instrucciones)|eres ahora|ahora eres|actua como|modo (desarrollador|dios)|developer mode|jailbreak|ignore (all |your |previous )*(instructions|rules)|you are now|dan mode/],
  ['owner_claim', /soy (el|la) (dueno|duena|jefe|administrador|admin)|el dueno (lo )?autoriz|descuento del? 100|gratis porque/],
  ['abuse', /\b(hijueputa|hp|gonorrea|malparid\w*|pirob\w*|perra|puta|marica|idiota|estupid\w*|imbecil|huevon|guevon|mierda|te voy a matar|los voy a matar|sexo|desnud\w*|porno|culo|verga)\b/],
  ['privacy_delete', /(borr|elimin|quit)\w* (todos )?(mis )?datos|olvid\w* (mis datos|mi numero|de mi)/],
  ['privacy_view', /(que|cuales) datos (tienen|tienes|guardan|tiene)|\bmis datos\b|datos personales/],
  ['human', /\b(asesor|asesora|humano|humana|agente|operador|operadora|alguien real|persona real|una persona|hablar con (alguien|una persona|el dueno|la duena)|atencion al cliente|me atiende alguien)\b/],
  ['robot', /(eres|es|sos|estoy hablando con) (un |una )?(robot|bot|maquina|chatbot|humano|persona|ia\b|inteligencia)|\bchatbot\b|\brobot\b/],
  ['complaint', /(llego|vino|venia|estaba|estaban|esta|estan|salio|salieron) (todo |toda )?(danad|podrid|malo|mala|mal|feo|fea|incomplet|roto|vencid|pasad|aplastad)|me cobraron (de mas|mal|doble)|\bqueja\b|reclamo|devolucion|reembolso|devuelvan|no (me )?llego|nunca llego|me falt|faltaron|pesimo|pesima|mal servicio|demorad|se demoro|llevo \d+ (horas|minutos) esperando/],
  ['health', /alergi|alergic|diabet|embaraz|lactancia|enfermedad|medicament|cancer|colesterol|hipertens|gastritis|celiac|sin gluten|\bcura\b|curar|sirve para (bajar|adelgazar|la tos|el dolor|la presion|el azucar|el higado|los rinones)|adelgazar|bajar de peso/],
  ['payment_claim', /\b(ya )?(pague|transferi|consigne|envie la plata|hice la transferencia|te pague|les pague)\b|comprobante|soporte de pago|pantallazo del pago/],
  ['discount', /descuent|rebaj|mas barat|me lo deja|precio especial|negociar|regateo|me hace precio|yapa|ganga/],
  ['cancel_order', /cancel\w* (mi |el )?pedido|anul\w* (mi |el )?pedido|ya no (lo )?quiero|no quiero (el|ese) pedido/],
  ['status', /(como va|donde va|ya viene|ya sale|ya salio|cuando llega|estado de(l| mi) pedido|mi domicilio|ya despacharon|en que va)/],
  ['my_orders', /^(mis pedidos|mi pedido|mis compras|historial)$/],
  ['repeat', /lo (mismo )?de siempre|lo mismo de la (vez|ultima)|repet\w* (el |mi )?(ultimo )?pedido|el mismo pedido|lo mismo que la (otra|ultima) vez/],
  ['hours', /horario|a que hora|abren|cierran|atienden|estan abiertos|esta abierto|hasta que hora|abiertos hoy|trabajan (hoy|el|los)/],
  ['location', /donde (estan|queda|quedan|es la tienda|los encuentro|se ubican)|direccion de (la tienda|ustedes)|ubicacion de|como llego|\bubicados\b/],
  ['payment_info', /(formas?|medios?|metodos?) de pago|\bnequi\b|daviplata|transferencia|datafono|\btarjeta\b|como (les )?pago|reciben (efectivo|tarjeta|nequi)|pago contra ?entrega/],
  ['delivery_info', /(hacen|tienen|hay) (domicilio|envio)|cuanto (vale|cuesta|cobran) el (domicilio|envio)|hasta donde (llevan|envian)|(llevan|envian|mandan) a |domicilio a |zona de (domicilio|entrega)|cobran (domicilio|envio)|envio gratis|domicilios/],
  ['offers', /(que|hay|tienen) (ofertas|promociones|promos)|\bofertas\b|\bpromocion(es)?\b/],
  ['catalog', /^(catalogo|productos|comprar|pedir|hacer (un )?pedido|quiero (hacer un )?pedido|lista de precios|lista|menu de productos|que venden|que tienen|que hay)$/],
  ['address_change', /cambi\w* (la |mi )?direccion|otra direccion|nueva direccion|actualiz\w* (la |mi )?direccion/],
  ['thanks', /^(ok |listo |dale |bueno )?(muchas |mil )?gracias\b|^dios (le|te) pague|^muy amable/],
  ['finish', /^(eso es todo|es todo|eso seria todo|seria todo|nada mas|solo eso|eso es|ya esta|ya es todo|listo eso es todo|terminar|finalizar( pedido)?|pagar)$/]
];
var GREETING_RE = /^(hola|buenas|buenos dias|buenas tardes|buenas noches|buen dia|buenas buenas|hi|hello|saludos|que mas|q hubo|quiubo|alo|hey)( (hola|buenas|como esta|como estas|como va|vecino|vecina|senor|senora|don|dona|amigo|amiga|sumerce))*\b/;
var AFFIRM = ['si', 'claro', 'dale', 'listo', 'ok', 'correcto', 'de una', 'si senor', 'si senora', 'perfecto', 'confirmo', 'confirmar', 'eso', 'exacto', 'va', 'bueno', 'vale', 'de acuerdo', 'si por favor', 'si esa', 'esa', 'si claro', 'afirmativo', 'yes'];
var DENY = ['no', 'nop', 'mejor no', 'no gracias', 'negativo', 'no por ahora', 'todavia no', 'aun no', 'no senor', 'no senora', 'cancela', 'nada'];
var OFFTOPIC_RE = /\b(receta|como se (hace|prepara|cocina)|chiste|poema|cancion|tarea|ensayo|traduce|traducir|programa|codigo|python|javascript|clima|noticias|futbol|partido|quien gano|presidente|elecciones|capital de|cuantos anos|cuentame|escribe(me)? un|que opinas|consejo|horoscopo|bitcoin|dolar|matematica|resuelve|ecuacion)\b/;
var ORDER_VERB_RE = /\b(quiero|quisiera|necesito|regalame|regala|mandame|manda|deme|dame|pedir|pido|agrega|agregar|agregue|ponme|pongame|anota|anotame|apunteme|encargar|encargo|comprar|llevar|me (vende|envia|trae))\b/;
var PRICE_RE = /cuanto (vale|cuesta|esta|sale|es|valen|cuestan|estan|salen)|\bprecio|a como|a cuanto|valor de(l)?\b|que precio/;
var AVAIL_RE = /^(y )?(hay|tienen|tiene|manejan|venden|les llego|llego)\b|\b(hay|tienen) \w+( \w+)? ?$/;
var REMOVE_RE = /^(y )?(quita|quitar|quitame|quiteme|saca|sacar|sacame|elimina|eliminar|borra|borrame|ya no (quiero|me mande)|sin)\b/;
var CHANGE_RE = /^(mejor|cambia|cambiar|cambie|cambiame|que sean|que sea|ponle|dejalo en|deja)\b/;

/** Detecta la intención principal con reglas. */
function detectIntent_(norm, raw) {
  var n = String(norm || '');
  if (!n) return 'empty';
  for (var i = 0; i < INTENT_RULES.length; i++) {
    if (INTENT_RULES[i][1].test(n)) return INTENT_RULES[i][0];
  }
  if (AFFIRM.indexOf(n) >= 0) return 'affirm';
  if (DENY.indexOf(n) >= 0) return 'deny';
  var rest = n.replace(GREETING_RE, '').trim();
  if (!rest || rest === 'por favor') return 'greeting';
  if (REMOVE_RE.test(rest)) return 'remove';
  if (PRICE_RE.test(rest)) return 'price';
  if (AVAIL_RE.test(rest)) return 'availability';
  if (CHANGE_RE.test(rest)) return 'change';
  if (ORDER_VERB_RE.test(rest)) return 'order';
  if (OFFTOPIC_RE.test(rest)) return 'offtopic';
  return 'unknown';
}

/** ¿Escribió en inglés? (respuesta corta en inglés, el flujo sigue igual) */
function looksEnglish_(norm) {
  var en = (' ' + norm + ' ').match(/ (hello|hi|do you|you have|have|how much|price|want|please|thanks|thank you|the|order|delivery|open|where|is|are|what|can i|i would like|buy) /g) || [];
  var es = (' ' + norm + ' ').match(/ (hola|quiero|cuanto|tienen|por favor|gracias|el|la|de|que|hay|donde) /g) || [];
  return en.length >= 2 && es.length === 0;
}

function isEmojiOnly_(raw) {
  var s = String(raw || '').trim();
  return !!s && !/[a-zA-Z0-9À-ſ]/.test(s);
}

var THUMBS_UP_RE = /^(👍|👌|✅|🙌|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿|☑️|✔️)+$/;
var THUMBS_DOWN_RE = /^(👎|👎🏻|👎🏼|👎🏽|👎🏾|👎🏿|❌)+$/;

// ───────────────────────── Pedidos escritos ─────────────────────────

/**
 * Extrae renglones de un pedido escrito: "2 lbs d tomate y 1/2 de cebolla larga".
 * Devuelve [{ raw, qty (en unidad del cliente o null), unit, words }] (sin resolver producto).
 */
function splitItems_(norm, units) {
  units = units || unitTable_();
  var text = ' ' + String(norm).replace(GREETING_RE, ' ') + ' ';
  text = text.replace(/ (por favor|gracias|me regala|me regalas|me hace el favor|me manda|me envia|quiero|quisiera|necesito|regalame|mandame|deme|dame|pedir|para pedir|me pone|ponme|agrega|agregame|tambien|ademas|y tambien) /g, ' , ');
  // Separadores: coma, punto y coma, saltos, "y", "mas" antes de un número o palabra.
  var parts = text.split(/\s*[,;\n+]\s*| y (?=\d)| mas (?=\d)| y (?!(media|medio)\b)/);
  // "2 kilos de tomate 1 libra de fresa": un número después de palabras empieza otro renglón.
  var split = [];
  parts.forEach(function (part) {
    part = String(part || '').trim();
    if ((part.match(/\b\d+(\.\d+)?\b/g) || []).length < 2) { split.push(part); return; }
    part.split(/ (?=\d)/).forEach(function (x, i, all) {
      if (i > 0 && !/[a-z]/.test(all[i - 1])) split[split.length - 1] += ' ' + x; else split.push(x);
    });
  });
  parts = split;
  var items = [];
  parts.forEach(function (part) {
    part = String(part || '').trim();
    if (!part || part === 'y') return;
    var words = part.split(' ');
    var qty = null, unit = null, rest = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (qty === null && /^\d+(\.\d+)?$/.test(w)) { qty = Number(w); continue; }
      var u = units[w] || units[stem_(w)];
      if (!unit && u && (qty !== null || i + 1 < words.length || words.length === 1)) { unit = u.unit; continue; }
      rest.push(w);
    }
    // "un poquito", "algo de": cantidad indefinida → se pregunta.
    if (/\b(poquito|poquitico|poco|algo|unos cuantos|unas cuantas|varios|varias)\b/.test(part)) qty = null;
    // "2 de tomate" → cantidad sin unidad; "tomate 2 libras" también funciona.
    var sig = significant_(rest);
    if (!sig.length && qty === null) return;
    items.push({ raw: part, qty: qty, unit: unit, words: rest });
  });
  return items;
}

/**
 * Entiende un pedido escrito contra el catálogo.
 * Devuelve { items: [...resueltos], asks: [...a preguntar], missing: [...no encontrados] }.
 */
function parseOrderText_(norm, index, units) {
  index = index || productIndex_();
  units = units || unitTable_();
  var out = { items: [], asks: [], missing: [], notes: [] };
  splitItems_(norm, units).forEach(function (it) {
    var phrase = it.words.join(' ');
    var match = matchProducts_(phrase, index);
    if (!match.known.length) {
      if (significant_(it.words).length) out.missing.push({ raw: it.raw, options: [] });
      return;
    }
    var res = resolveProduct_(match);
    var base = { raw: it.raw, qty: it.qty, unit: it.unit, extra: match.extra };
    if (res.status === 'none') { out.missing.push({ raw: it.raw, options: res.options }); return; }
    if (res.status === 'ask') { out.asks.push(Object.assign(base, { kind: 'product', options: res.options })); return; }
    var p = res.product;
    var item = Object.assign(base, { id: p.id, p: p.p, confidence: res.confidence, visible: p.visible });
    if (it.qty === null) { item.kind = 'qty'; out.asks.push(item); return; }
    var weight = units[normalize_(p.p.unidad)] && units[normalize_(p.p.unidad)].grams;
    // "3 limones" cuando el limón se vende por kilo: no se adivina, se pregunta.
    if (!it.unit && weight && it.qty >= 1 && it.qty % 1 === 0) { item.kind = 'unit'; out.asks.push(item); return; }
    var conv = convertQty_(it.qty, it.unit, p.p.unidad, units);
    if (!conv.ok) { item.kind = 'unit'; out.asks.push(item); return; }
    var step = qtyStep_(p.p.unidad);
    var rounded = Math.round(conv.qty / step) * step;
    if (rounded <= 0) rounded = step;
    item.cantidad = Math.round(rounded * 100) / 100;
    item.approx = Math.abs(rounded - conv.qty) > 1e-9;
    if (match.extra.length) out.notes.push(p.p.nombre + ': ' + match.extra.join(' '));
    out.items.push(item);
  });
  return out;
}

/** Datos personales delicados que el cliente no debería mandar (tarjeta, cédula, claves). */
function sensitiveData_(raw) {
  var s = String(raw || '');
  var n = normalize_(s);
  if (/(\d[ -]?){13,19}/.test(s)) return 'tarjeta';
  if (/\b(clave|contrasena|password|pin|codigo de verificacion|cvv|cvc)\b/.test(n) && /\d{3,}/.test(s)) return 'clave';
  if (/\b(cedula|cc|documento)\b/.test(n) && /\d{6,10}/.test(s)) return 'cedula';
  return '';
}

/** Oculta números largos (posibles tarjetas o documentos) para registros y notas. */
function redact_(s) {
  return String(s || '').replace(/(\d[ -]?){6,}\d/g, function (m) { return '[' + m.replace(/\D/g, '').length + ' dígitos]'; });
}
