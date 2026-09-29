/*
 * Demo web: dos teléfonos (cliente y dueño) hablando con el bot real (apps-script/*.gs) dentro del navegador.
 * El motor y la hoja son simulados en memoria (demo-env.js); no hay servidor ni WhatsApp real.
 */
(function () {
  'use strict';
  var CUSTOMER = '573001112233';
  var WORKER = '573004445566';
  var NAMES = {}; NAMES[CUSTOMER] = 'Cliente demo'; NAMES[WORKER] = 'Dueño';
  var CHIPS = [
    'hola',
    'buenas me regala 2 lbs d tomate chonto y 3 aguacatess xfa',
    'hay lulo??',
    'cuanto vale el kilo de mora',
    'a que hora abren',
    'quiero media libra de fresa y una piña',
    'el mango llego podrido',
    'asesor'
  ];
  var WORKER_CHIPS = ['pedidos', 'hoy', 'ayuda', 'asesor', 'pausar'];

  var env, seq = 0, carts = {}, queue = {}, timer = null;
  var chats = {}; chats[CUSTOMER] = document.getElementById('chat-customer'); chats[WORKER] = document.getElementById('chat-worker');

  // ───────── arranque ─────────
  function boot() {
    env = NFEnv.createEnv(NF_GS_SOURCES);
    var log = console.log; console.log = function () {};
    try { env.gs.setup(); } finally { console.log = log; }
    var w = env.gs.table_('Trabajadores');
    env.gs.setCell_(w, w.rows[0], 'whatsapp', WORKER);
    ['WA_TOKEN', 'WA_PHONE_ID', 'WA_CATALOG_ID'].forEach(function (k) { env.props.set(k, 'demo'); });
    setConfig('horario', 'lun-dom 00:00-23:59');
    setConfig('espera_rafaga_seg', 0);
    setConfig('ia_activa', 'no');
    setConfig('sugerir', 'si');
    setConfig('metodos_pago', 'Efectivo contraentrega, Nequi');
    setConfig('datos_pago', 'Nequi 300 000 0000 (demo)');
    setConfig('hora_resumen', '');
    carts = {}; queue = {};
    chats[CUSTOMER].innerHTML = ''; chats[WORKER].innerHTML = '';
    refreshSheet();
    if (timer) clearInterval(timer);
    // Tareas de cada 5 minutos (escalar asesor, reintentos, recordatorios): aquí, cada minuto.
    timer = setInterval(function () { var b = env.fetches.length; try { env.gs.runEveryFiveMinutes(); } catch (e) { console.warn(e); } deliver(b); }, 60000);
  }

  function setConfig(key, value) {
    var t = env.gs.table_('Config');
    var row = t.rows.filter(function (r) { return String(r.clave).trim() === key; })[0];
    if (row) env.gs.setCell_(t, row, 'valor', value); else env.gs.writeRow_(t, { clave: key, valor: value, nota: '' });
  }

  // ───────── enviar al bot ─────────
  function send(phone, msg, echo) {
    if (echo) addUser(phone, echo);
    var before = env.fetches.length;
    var m = { from: phone, id: 'wamid.demo' + (++seq), timestamp: String(Math.floor(Date.now() / 1000)) };
    Object.keys(msg).forEach(function (k) { m[k] = msg[k]; });
    try {
      env.gs.handlePost_({
        action: 'wa_webhook', secret: env.props.get('RELAY_SECRET'),
        payload: { entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: phone, profile: { name: NAMES[phone] } }], messages: [m] } }] }] }
      });
    } catch (err) { console.error(err); toast('Algo falló en la demo: ' + err.message); }
    deliver(before);
  }
  var sendText = function (phone, t) { send(phone, { type: 'text', text: { body: t } }, t); };
  var sendReply = function (phone, id, title) { send(phone, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: id, title: title } } }, title); };
  var sendList = function (phone, id, title) { send(phone, { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: id, title: title } } }, title); };

  /** Lo que el bot mandó a "WhatsApp" (llamadas a la API de Meta simulada) → burbujas en el teléfono que corresponde. */
  function deliver(before) {
    env.fetches.slice(before).filter(function (f) { return /\/messages$/.test(f.url) && f.payload && f.payload.type; }).forEach(function (f) {
      var to = String(f.payload.to);
      if (!chats[to]) return;
      queue[to] = (queue[to] || 0) + 1;
      setTimeout(function () { render(to, f.payload); queue[to]--; }, queue[to] * 350);
    });
    refreshSheet();
  }

  // ───────── dibujar mensajes ─────────
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmt(s) {
    return esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/gm, '$1<i>$2</i>').replace(/~([^~\n]+)~/g, '<s>$1</s>').replace(/\n/g, '<br>');
  }
  function clock() { return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function scroll(phone) { var c = chats[phone]; c.scrollTop = c.scrollHeight; }

  function addUser(phone, text) {
    var m = el('div', 'msg out');
    m.appendChild(el('div', 'bubble', fmt(text)));
    m.appendChild(el('span', 'time', clock()));
    chats[phone].appendChild(m); scroll(phone);
  }

  function button(label, onclick) {
    var b = el('button', 'btn', esc(label)); b.type = 'button';
    b.addEventListener('click', function () { onclick(b); });
    return b;
  }

  function product(id) {
    var row = env.gs.table_('Productos').rows.filter(function (p) { return String(p.id) === id; })[0];
    return row ? env.gs.publicProduct_(row, env.gs.todayStr_()) : null;
  }

  function render(phone, payload) {
    var m = el('div', 'msg in');
    var g = env.gs;
    if (payload.type === 'text') {
      m.appendChild(el('div', 'bubble', fmt(payload.text.body)));
    } else if (payload.type === 'template') {
      var params = ((payload.template.components[0] || {}).parameters || []).map(function (p) { return p.text; });
      m.appendChild(el('div', 'bubble', '📨 <i>[Plantilla ' + esc(payload.template.name) + ']</i> ' + esc(params.join(' · '))));
    } else if (payload.type === 'interactive') {
      var i = payload.interactive;
      var body = i.body ? i.body.text : '';
      if (i.type === 'button') {
        m.appendChild(el('div', 'bubble', fmt(body)));
        var box = el('div', 'btns');
        i.action.buttons.forEach(function (b) { box.appendChild(button(b.reply.title, function () { sendReply(phone, b.reply.id, b.reply.title); })); });
        m.appendChild(box);
      } else if (i.type === 'list') {
        m.appendChild(el('div', 'bubble', fmt(body)));
        var rows = el('div', 'rows'); rows.hidden = true;
        i.action.sections[0].rows.forEach(function (r) {
          var row = el('button', 'row', esc(r.title) + (r.description ? '<small>' + esc(r.description) + '</small>' : '')); row.type = 'button';
          row.addEventListener('click', function () { rows.hidden = true; sendList(phone, r.id, r.title); });
          rows.appendChild(row);
        });
        var open = button('☰ ' + i.action.button, function () { rows.hidden = !rows.hidden; scroll(phone); });
        m.appendChild(open); m.appendChild(rows);
      } else if (i.type === 'product_list') {
        m.appendChild(el('div', 'bubble', '<b>' + esc(i.header ? i.header.text : 'Productos') + '</b><br>' + fmt(body)));
        var list = el('div', 'products');
        cartOf(phone);
        i.action.sections[0].product_items.forEach(function (it) { var p = product(it.product_retailer_id); if (p) list.appendChild(productCard(phone, p)); });
        m.appendChild(list);
        var cartBtn = button('🛒 Enviar carrito', function () { sendCart(phone); }); cartBtn.classList.add('cartbtn');
        m.appendChild(cartBtn);
      } else if (i.type === 'catalog_message') {
        m.appendChild(el('div', 'bubble', fmt(body)));
        m.appendChild(button('Ver categorías', function () { sendReply(phone, 'cat', 'Ver categorías'); }));
      } else {
        m.appendChild(el('div', 'bubble', fmt(body)));
      }
    }
    m.appendChild(el('span', 'time', clock()));
    chats[phone].appendChild(m); scroll(phone);
  }

  // ───────── catálogo y carrito de WhatsApp ─────────
  function cartOf(phone) { return carts[phone] || (carts[phone] = {}); }

  function productCard(phone, p) {
    var card = el('div', 'prod');
    var photo = p.foto ? (/^https?:/.test(p.foto) ? p.foto : p.foto) : 'img/sin-foto.jpg';
    var img = el('img'); img.src = photo; img.alt = ''; img.loading = 'lazy';
    img.onerror = function () { img.onerror = null; img.src = 'img/sin-foto.jpg'; };
    card.appendChild(img);
    var price = p.oferta !== null && p.oferta !== undefined
      ? '<span class="old">' + env.gs.money_(p.precio) + '</span><b>' + env.gs.money_(p.oferta) + '</b>'
      : env.gs.money_(p.precio);
    var info = el('div', '', '<b>' + esc(p.nombre) + '</b><span>' + price + ' / ' + esc(env.gs.unitLabel_(p.unidad)) + '</span>');
    card.appendChild(info);
    var q = el('div', 'qty');
    var out = el('output', '', String(cartOf(phone)[p.id] || 0));
    var minus = el('button', '', '−'); minus.type = 'button'; minus.setAttribute('aria-label', 'Quitar ' + p.nombre);
    var plus = el('button', '', '+'); plus.type = 'button'; plus.setAttribute('aria-label', 'Agregar ' + p.nombre);
    function set(n) { n = Math.max(0, n); if (n) cartOf(phone)[p.id] = n; else delete cartOf(phone)[p.id]; out.textContent = String(n); }
    minus.addEventListener('click', function () { set((cartOf(phone)[p.id] || 0) - 1); });
    plus.addEventListener('click', function () { set((cartOf(phone)[p.id] || 0) + 1); });
    q.appendChild(minus); q.appendChild(out); q.appendChild(plus);
    card.appendChild(q);
    return card;
  }

  function sendCart(phone) {
    var cart = cartOf(phone);
    var ids = Object.keys(cart);
    if (!ids.length) { toast('Primero agrega productos con  +'); return; }
    var items = ids.map(function (id) { return { product_retailer_id: id, quantity: cart[id], item_price: 0, currency: 'COP' }; });
    carts[phone] = {};
    document.querySelectorAll('#chat-' + (phone === CUSTOMER ? 'customer' : 'worker') + ' .qty output').forEach(function (o) { o.textContent = '0'; });
    var summary = ids.map(function (id) { var p = product(id); return cart[id] + ' × ' + (p ? p.nombre : id); }).join(', ');
    send(phone, { type: 'order', order: { catalog_id: 'demo', product_items: items } }, '🛒 ' + summary);
  }

  // ───────── hoja de Google ─────────
  function refreshSheet() {
    var g = env.gs;
    var orders = g.table_('Pedidos').rows.filter(function (r) { return r.nro; }).reverse();
    var body = document.querySelector('#orders tbody');
    body.innerHTML = orders.length ? '' : '<tr><td class="empty" colspan="6">Todavía no hay pedidos. Haz uno en el teléfono del cliente 👆</td></tr>';
    orders.forEach(function (o) {
      var tr = el('tr', '', '<td><b>' + esc(o.nro) + '</b></td><td><span class="pill ' + esc(o.estado) + '">' + esc(g.STATE_LABELS[o.estado] || o.estado) + '</span></td><td>' +
        esc(o.cliente) + '</td><td>' + (o.entrega === 'domicilio' ? '🛵 ' + esc(o.direccion) : '🏪 recoge') + '</td><td>' + esc(o.pago || '—') + '</td><td>' + g.money_(o.total) + '</td>');
      body.appendChild(tr);
    });
    document.getElementById('sheet-count').textContent = orders.length ? '(' + orders.length + ')' : '';
  }

  // ───────── interfaz ─────────
  function toast(text) {
    var t = el('div', 'toast', esc(text)); document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function chips(container, list, phone) {
    list.forEach(function (t) {
      var c = el('button', 'chip', esc(t)); c.type = 'button';
      c.addEventListener('click', function () { sendText(phone, t); });
      container.appendChild(c);
    });
  }
  function bindForm(formId, inputId, phone) {
    var form = document.getElementById(formId), input = document.getElementById(inputId);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim(); if (!v) return;
      input.value = '';
      sendText(phone, v);
    });
  }

  chips(document.getElementById('chips'), CHIPS, CUSTOMER);
  var wc = el('div', ''); wc.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:6px 8px;background:var(--card);border-top:1px solid var(--line)';
  chips(wc, WORKER_CHIPS, WORKER);
  document.getElementById('form-worker').before(wc);
  bindForm('form-customer', 'input-customer', CUSTOMER);
  bindForm('form-worker', 'input-worker', WORKER);
  document.querySelector('[data-tool="location"]').addEventListener('click', function () {
    send(CUSTOMER, { type: 'location', location: { latitude: 4.8133, longitude: -75.6961, name: 'Mi ubicación' } }, '📍 Ubicación compartida');
  });
  document.querySelector('[data-tool="image"]').addEventListener('click', function () {
    send(CUSTOMER, { type: 'image', image: { id: 'demo-imagen', caption: '' } }, '📷 Foto');
  });
  document.getElementById('reset').addEventListener('click', function () { boot(); toast('Demo reiniciada'); });

  boot();
  window.NFDemo = { send: send, env: function () { return env; } };
})();
