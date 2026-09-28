/* Natural Fruver — catálogo para clientes. */
(function () {
  'use strict';

  var NF = window.NF;
  var esc = NF.escapeHtml;
  var CART_KEY = 'nf_carrito';
  var CATALOG_KEY = 'nf_catalogo';
  var CUSTOMER_KEY = 'nf_cliente';
  var MAX_QTY = 50;

  var state = {
    catalog: null,
    byId: {},
    categories: {},
    cart: {},
    cat: '',
    q: '',
    orderDone: false // mientras se muestra la pantalla de "pedido separado"
  };

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  // ---------- almacenamiento local (puede fallar en modo privado) ----------

  function load(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* sin almacenamiento */ }
  }

  // ---------- catálogo ----------

  function init() {
    state.cart = load(CART_KEY, {}) || {};
    bindEvents();
    $('#demo-note').hidden = !NF.isDemo();

    var cached = load(CATALOG_KEY, null);
    if (cached && cached.productos) setCatalog(cached);
    refreshCatalog();
    // Si el cliente deja la página abierta, los precios se refrescan al volver.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshCatalog();
    });
  }

  function refreshCatalog() {
    return NF.getCatalog().then(function (cat) {
      if (!cat || !cat.ok) throw new Error((cat && cat.mensaje) || 'Catálogo no disponible');
      save(CATALOG_KEY, cat);
      setCatalog(cat);
    }).catch(function (err) {
      console.error(err);
      if (!state.catalog) {
        $('#main').innerHTML = '<div class="empty"><p>No pudimos cargar el catálogo. Revisa tu conexión e intenta de nuevo.</p>' +
          '<button class="btn" type="button" onclick="location.reload()">Reintentar</button></div>';
      }
    });
  }

  function setCatalog(cat) {
    state.catalog = cat;
    state.byId = {};
    cat.productos.forEach(function (p) { state.byId[p.id] = p; });
    state.categories = {};
    cat.categorias.forEach(function (c) { state.categories[c.nombre] = c; });

    // El carrito solo guarda productos que siguen existiendo, sin pasar el inventario.
    Object.keys(state.cart).forEach(function (id) {
      var p = state.byId[id];
      if (!p || !p.disponible) delete state.cart[id];
      else state.cart[id] = Math.min(state.cart[id], maxQty(p));
    });
    save(CART_KEY, state.cart);

    renderHeader();
    renderChips();
    renderMain();
    renderCartButton();
    openFromHash();
    if ($('#cart-dialog').open && !state.orderDone) renderCart();
  }

  function cfg() {
    return (state.catalog && state.catalog.config) || {};
  }

  function renderHeader() {
    var c = cfg();
    var name = c.nombre_tienda || 'Natural Fruver';
    $('#store-name').textContent = name;
    var os = NF.openState(c.horario);
    var el = $('#open-state');
    el.hidden = !os;
    if (os) {
      el.innerHTML = '<span class="dot" aria-hidden="true"></span>' + esc(os.text);
      el.classList.toggle('is-open', os.open);
    }
    var banner = $('#banner');
    banner.hidden = !c.banner;
    banner.textContent = c.banner || '';
    if (c.instagram) $('#ig-link').href = 'https://www.instagram.com/' + encodeURIComponent(c.instagram) + '/';

    var foot = [];
    if (c.direccion_tienda) foot.push(footRow('map-pin', esc(c.direccion_tienda)));
    if (c.horario) foot.push(footRow('clock', esc(c.horario)));
    if (c.zonas_domicilio) foot.push(footRow('moped', 'Domicilios: ' + esc(c.zonas_domicilio) + deliveryText(c)));
    if (c.whatsapp) {
      foot.push(footRow('whatsapp-logo', '<a href="' + NF.waLink(c.whatsapp, 'Hola, tengo una pregunta') + '" target="_blank" rel="noopener">Escríbenos por WhatsApp</a>'));
    }
    foot.unshift('<p class="foot-mark">' + esc(name) + '</p>');
    $('#foot').innerHTML = foot.join('');
  }

  function footRow(iconName, html) {
    return '<p class="foot-row">' + NF.icon(iconName) + '<span>' + html + '</span></p>';
  }

  function deliveryText(c) {
    var parts = [];
    if (Number(c.domicilio_valor) > 0) parts.push('valor ' + NF.money(c.domicilio_valor));
    if (Number(c.domicilio_gratis_desde) > 0) parts.push('gratis desde ' + NF.money(c.domicilio_gratis_desde));
    return parts.length ? ' (' + parts.join(', ') + ')' : '';
  }

  // ---------- categorías y listado ----------

  function renderChips() {
    var cat = state.catalog;
    var chips = [{ key: '', label: 'Todo' }];
    if (cat.productos.some(function (p) { return p.oferta != null && p.disponible; })) {
      chips.push({ key: 'ofertas', label: 'Ofertas' });
    }
    cat.categorias.forEach(function (c) {
      chips.push({ key: c.nombre, label: c.nombre });
    });
    if (state.cat && !chips.some(function (c) { return c.key === state.cat; })) state.cat = '';
    $('#chips').innerHTML = chips.map(function (c) {
      return '<button type="button" class="tab-cat" data-cat="' + esc(c.key) + '" aria-pressed="' + (c.key === state.cat) + '">' + esc(c.label) + '</button>';
    }).join('');
  }

  function renderMain() {
    var all = state.catalog.productos;
    var html = '';
    if (state.q) {
      var found = NF.search(all, state.q);
      html = found.length
        ? section(found.length + (found.length === 1 ? ' resultado' : ' resultados'), found)
        : notFound();
    } else if (state.cat === 'ofertas') {
      html = section('Ofertas', all.filter(function (p) { return p.oferta != null; }));
    } else if (state.cat) {
      html = section(state.cat, all.filter(function (p) { return p.categoria === state.cat; }));
    } else {
      var featured = all.filter(function (p) { return p.destacado && p.disponible; });
      if (featured.length) html += section('Destacados de hoy', featured, 'row');
      state.catalog.categorias.forEach(function (c) {
        var list = all.filter(function (p) { return p.categoria === c.nombre; });
        if (list.length) html += section(c.nombre, list, '', c.nombre);
      });
    }
    $('#main').innerHTML = html || '<div class="empty"><p>Pronto agregaremos productos.</p></div>';
  }

  function section(title, list, layout, catKey) {
    var more = catKey
      ? '<button type="button" class="link" data-cat="' + esc(catKey) + '">Ver todo' + NF.icon('caret-right', 'ic-sm') + '</button>'
      : '';
    return '<section class="block"><div class="block-head"><h2 class="rule-title">' + esc(title) + '</h2>' + more + '</div>' +
      '<div class="' + (layout === 'row' ? 'row-scroll' : 'grid') + '">' + list.map(card).join('') + '</div></section>';
  }

  function notFound() {
    var c = cfg();
    var ask = c.whatsapp
      ? '<a class="btn" target="_blank" rel="noopener" href="' + NF.waLink(c.whatsapp, 'Hola, ¿tienen ' + state.q + '?') + '">' + NF.icon('whatsapp-logo') + 'Preguntar por WhatsApp</a>'
      : '';
    return '<div class="empty"><p>No encontramos “' + esc(state.q) + '”.</p>' + ask + '</div>';
  }

  function media(p, big) {
    if (p.foto) {
      return '<img src="' + esc(p.foto) + '" alt="' + esc(p.nombre) + '" loading="lazy" decoding="async"' + (big ? '' : ' width="300" height="300"') + '>';
    }
    var t = NF.placeholderTile(p);
    return '<span class="ph" style="--h:' + t.hue + '" aria-hidden="true"><span class="ph-initial">' + esc(t.initial) + '</span>' +
      '<span class="ph-cat">' + esc(p.categoria) + '</span></span>';
  }

  function priceHtml(p) {
    var unit = '<span class="unit">/' + esc(NF.unitLabel(p.unidad)) + '</span>';
    var was = p.oferta != null ? '<s class="was">' + NF.money(p.precio) + '</s>' : '';
    return '<p class="price">' + was + '<span class="tag' + (p.oferta != null ? ' is-sale' : '') + '">' +
      '<strong>' + NF.money(NF.priceOf(p)) + '</strong>' + unit + '</span></p>';
  }

  function card(p) {
    var pct = NF.discountPct(p);
    return '<article class="card' + (p.disponible ? '' : ' is-out') + '" data-id="' + esc(p.id) + '">' +
      '<button type="button" class="card-media" data-open="' + esc(p.id) + '" aria-label="Ver ' + esc(p.nombre) + '">' + media(p) +
      (pct > 0 ? '<span class="stamp">Oferta −' + pct + '%</span>' : '') +
      (p.disponible ? '' : '<span class="stamp is-out">Agotado</span>') + '</button>' +
      '<div class="card-body"><h3>' + esc(p.nombre) + '</h3>' + priceHtml(p) +
      '<div class="controls">' + controls(p) + '</div></div></article>';
  }

  function maxQty(p) {
    return p.stock != null ? Math.min(p.stock, MAX_QTY) : MAX_QTY;
  }

  function controls(p) {
    if (!p.disponible) return '<span class="out">Vuelve pronto</span>';
    var q = state.cart[p.id] || 0;
    if (!q) return '<button type="button" class="btn add" data-add="' + esc(p.id) + '" aria-label="Agregar ' + esc(p.nombre) + '">' + NF.icon('plus') + 'Agregar</button>';
    var atMax = q + NF.step(p.unidad) > maxQty(p);
    return '<div class="stepper">' +
      '<button type="button" data-dec="' + esc(p.id) + '" aria-label="Quitar ' + esc(p.nombre) + '">' + NF.icon('minus') + '</button>' +
      '<span aria-live="polite">' + NF.qty(q) + ' ' + esc(NF.unitLabel(p.unidad)) + '</span>' +
      '<button type="button" data-inc="' + esc(p.id) + '" aria-label="Agregar más ' + esc(p.nombre) + '"' + (atMax ? ' disabled' : '') + '>' + NF.icon('plus') + '</button></div>';
  }

  // ---------- carrito ----------

  function changeQty(id, delta) {
    var p = state.byId[id];
    if (!p || !p.disponible) return;
    var q = (state.cart[id] || 0) + delta;
    q = Math.round(q * 100) / 100;
    if (q <= 0) delete state.cart[id];
    else state.cart[id] = Math.min(q, maxQty(p));
    save(CART_KEY, state.cart);
    refreshProduct(id);
    renderCartButton();
    if ($('#cart-dialog').open && !state.orderDone) renderCart();
  }

  function refreshProduct(id) {
    var p = state.byId[id];
    $$('.card[data-id="' + cssEscape(id) + '"] .controls').forEach(function (el) { el.innerHTML = controls(p); });
    var detail = $('#product-body .controls[data-id="' + cssEscape(id) + '"]');
    if (detail) detail.innerHTML = controls(p);
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"');
  }

  function cartLines() {
    return Object.keys(state.cart).map(function (id) {
      var p = state.byId[id];
      if (!p) return null;
      var q = state.cart[id];
      return { id: id, p: p, nombre: p.nombre, unidad: p.unidad, cantidad: q, precio: NF.priceOf(p), total: Math.round(NF.priceOf(p) * q) };
    }).filter(Boolean);
  }

  function totals(entrega) {
    var lines = cartLines();
    var subtotal = lines.reduce(function (s, l) { return s + l.total; }, 0);
    var c = cfg();
    var fee = 0;
    if (entrega === 'domicilio') {
      fee = Number(c.domicilio_valor) || 0;
      var free = Number(c.domicilio_gratis_desde) || 0;
      if (free > 0 && subtotal >= free) fee = 0;
    }
    return { lines: lines, subtotal: subtotal, domicilio: fee, total: subtotal + fee };
  }

  function renderCartButton() {
    var t = totals('recoger');
    var n = t.lines.length;
    var btn = $('#cart-button');
    btn.hidden = !n;
    $('#cart-count').textContent = n;
    $('#cart-total').textContent = NF.money(t.subtotal);
    document.body.classList.toggle('has-cart', n > 0);
  }

  function currentEntrega() {
    var checked = $('#checkout input[name="entrega"]:checked');
    return checked ? checked.value : (load(CUSTOMER_KEY, {}).entrega || 'domicilio');
  }

  function renderCart() {
    var body = $('#cart-body');
    var formState = readForm();
    var entrega = formState ? formState.entrega : currentEntrega();
    var t = totals(entrega);
    if (!t.lines.length) {
      body.innerHTML = '<div class="empty"><p>Tu pedido está vacío.</p><button class="btn" type="button" data-close>Ver productos</button></div>';
      return;
    }
    var c = cfg();
    var min = Number(c.pedido_minimo) || 0;
    var html = '<ul class="receipt">' + t.lines.map(function (l) {
      return '<li>' + NF.leaderRow(esc(l.nombre), NF.money(l.total)) +
        '<div class="line-sub"><small>' + NF.money(l.precio) + ' / ' + esc(NF.unitLabel(l.unidad)) + '</small>' +
        '<div class="controls" data-id="' + esc(l.id) + '">' + controls(l.p) + '</div></div></li>';
    }).join('') + '</ul>';
    html += '<div class="receipt-sum">' + NF.leaderRow('Subtotal', NF.money(t.subtotal));
    if (entrega === 'domicilio') html += NF.leaderRow('Domicilio', t.domicilio ? NF.money(t.domicilio) : 'Gratis');
    html += NF.leaderRow('Total', NF.money(t.total), 'is-total') + '</div>';
    var free = Number(c.domicilio_gratis_desde) || 0;
    if (entrega === 'domicilio' && free > 0 && t.subtotal < free && Number(c.domicilio_valor) > 0) {
      html += '<p class="hint">Te faltan ' + NF.money(free - t.subtotal) + ' para domicilio gratis.</p>';
    }
    if (min > 0 && t.subtotal < min) {
      html += '<p class="hint warn">El pedido mínimo es ' + NF.money(min) + '.</p>';
    }
    body.innerHTML = html;
    body.appendChild($('#checkout-template').content.cloneNode(true));
    fillForm(formState || load(CUSTOMER_KEY, {}));
    $('#send-order').disabled = min > 0 && t.subtotal < min;
  }

  function readForm() {
    var f = $('#checkout');
    if (!f) return null;
    return {
      entrega: (f.querySelector('input[name="entrega"]:checked') || {}).value || 'domicilio',
      nombre: f.nombre.value.trim(),
      telefono: f.telefono.value.trim(),
      direccion: f.direccion.value.trim(),
      notas: f.notas.value.trim(),
      website: f.website.value
    };
  }

  function fillForm(data) {
    var f = $('#checkout');
    if (!f || !data) return;
    ['nombre', 'telefono', 'direccion', 'notas'].forEach(function (k) { if (data[k]) f[k].value = data[k]; });
    var radio = f.querySelector('input[name="entrega"][value="' + (data.entrega === 'recoger' ? 'recoger' : 'domicilio') + '"]');
    if (radio) radio.checked = true;
    toggleAddress();
  }

  function toggleAddress() {
    var f = $('#checkout');
    if (!f) return;
    var home = currentEntrega() === 'domicilio';
    f.querySelector('[data-for="domicilio"]').hidden = !home;
  }

  function showFormError(msg) {
    var el = $('#checkout-error');
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
  }

  function submitOrder(e) {
    e.preventDefault();
    var data = readForm();
    if (data.nombre.length < 2) return showFormError('Escribe tu nombre.');
    if (data.telefono.replace(/\D/g, '').length < 7) return showFormError('Escribe un teléfono válido.');
    if (data.entrega === 'domicilio' && data.direccion.length < 5) return showFormError('Escribe la dirección y el barrio.');
    showFormError('');
    save(CUSTOMER_KEY, { nombre: data.nombre, telefono: data.telefono, direccion: data.direccion, entrega: data.entrega });

    var btn = $('#send-order');
    btn.disabled = true;
    btn.classList.add('loading');

    var items = cartLines().map(function (l) { return { id: l.id, cantidad: l.cantidad }; });
    var request = NF.isDemo()
      ? Promise.resolve(demoOrder(data.entrega))
      : NF.post({ action: 'pedido', items: items, cliente: data, website: data.website });

    request.then(function (res) {
      if (res && res.ok) return orderDone(res, data);
      btn.disabled = false;
      btn.classList.remove('loading');
      if (res && res.error === 'sin_stock') return stockProblems(res.problemas || []);
      showFormError((res && res.mensaje) || 'No pudimos registrar el pedido. Intenta de nuevo.');
    }).catch(function (err) {
      console.error(err);
      btn.disabled = false;
      btn.classList.remove('loading');
      offlineFallback(data);
    });
  }

  function demoOrder(entrega) {
    var t = totals(entrega);
    return {
      ok: true,
      nro: 'DEMO-' + Math.floor(1000 + Math.random() * 9000),
      lineas: t.lines.map(function (l) { return { nombre: l.nombre, unidad: l.unidad, cantidad: l.cantidad, precio: l.precio, total: l.total }; }),
      subtotal: t.subtotal, domicilio: t.domicilio, total: t.total,
      whatsapp: cfg().whatsapp
    };
  }

  function orderDone(res, customer) {
    var c = cfg();
    var link = NF.waLink(res.whatsapp || c.whatsapp, NF.orderMessage(res, customer, c.nombre_tienda));
    state.orderDone = true;
    state.cart = {};
    save(CART_KEY, state.cart);
    renderCartButton();
    renderMain();
    $('#cart-body').innerHTML =
      '<div class="done">' + NF.icon('check-circle', 'done-icon') +
      '<p class="done-nro">Pedido ' + esc(res.nro) + '</p>' +
      '<h3>¡Separado!</h3>' +
      '<p>Ahora envíalo por WhatsApp para que te lo confirmemos. Total: <strong>' + NF.money(res.total) + '</strong></p>' +
      '<a class="btn primary big" id="wa-link" href="' + esc(link) + '" target="_blank" rel="noopener">' + NF.icon('whatsapp-logo') + 'Abrir WhatsApp</a>' +
      (NF.isDemo() ? '<p class="fine">Modo demostración: el pedido no se guardó.</p>' : '') +
      '</div>';
    // Intentamos abrir WhatsApp directamente; si el navegador lo bloquea, queda el botón.
    setTimeout(function () { window.location.href = link; }, 400);
    refreshCatalog();
  }

  function stockProblems(problems) {
    var msgs = problems.map(function (p) {
      var prod = state.byId[p.id];
      if (p.motivo === 'stock' && prod && p.disponible > 0) {
        state.cart[p.id] = Math.floor(p.disponible / NF.step(prod.unidad)) * NF.step(prod.unidad);
        if (!state.cart[p.id]) delete state.cart[p.id];
        return p.nombre + ': solo quedan ' + NF.qty(p.disponible) + ' ' + NF.unitLabel(prod.unidad) + ' (ajustamos tu pedido)';
      }
      delete state.cart[p.id];
      return p.nombre + ': se agotó (lo quitamos del pedido)';
    });
    save(CART_KEY, state.cart);
    refreshCatalog().then(function () {
      renderCart();
      showFormError('Cambió la disponibilidad. ' + msgs.join('. ') + '. Revisa y vuelve a enviar.');
    });
  }

  function offlineFallback(customer) {
    var t = totals(customer.entrega);
    var c = cfg();
    var order = { nro: '(sin número)', lineas: t.lines, subtotal: t.subtotal, domicilio: t.domicilio, total: t.total };
    var link = NF.waLink(c.whatsapp, NF.orderMessage(order, customer, c.nombre_tienda));
    showFormError('');
    var el = $('#checkout-error');
    el.hidden = false;
    el.innerHTML = 'No pudimos conectar con la tienda. Puedes enviar el pedido igual por WhatsApp: ' +
      '<a href="' + esc(link) + '" target="_blank" rel="noopener">enviar sin separar productos</a>.';
  }

  // ---------- detalle de producto ----------

  function openProduct(id, push) {
    var p = state.byId[id];
    if (!p) return;
    var hasta = p.oferta != null && p.oferta_hasta ? '<p class="hint">Oferta hasta el ' + esc(p.oferta_hasta.split('-').reverse().join('/')) + '</p>' : '';
    var stock = p.stock != null && p.disponible && p.stock <= 5 ? '<p class="hint warn">¡Quedan ' + NF.qty(p.stock) + ' ' + esc(NF.unitLabel(p.unidad)) + '!</p>' : '';
    $('#product-body').innerHTML =
      '<div class="sheet-head" tabindex="-1" autofocus><span class="crumb">' + esc(p.categoria) + '</span>' +
      '<div class="head-actions"><button type="button" class="icon-btn" data-share="' + esc(p.id) + '" aria-label="Compartir">' + NF.icon('share-network') + '</button>' +
      '<button type="button" class="icon-btn" data-close aria-label="Cerrar">' + NF.icon('x') + '</button></div></div>' +
      '<div class="detail-media">' + media(p, true) + (NF.discountPct(p) > 0 ? '<span class="stamp">Oferta −' + NF.discountPct(p) + '%</span>' : '') + '</div>' +
      '<h2 class="detail-name">' + esc(p.nombre) + '</h2>' + priceHtml(p) + hasta + stock +
      (p.descripcion ? '<p class="desc">' + esc(p.descripcion) + '</p>' : '') +
      '<div class="controls big" data-id="' + esc(p.id) + '">' + controls(p) + '</div>';
    var dlg = $('#product-dialog');
    if (!dlg.open) dlg.showModal();
    if (push !== false) history.replaceState(null, '', '#p=' + encodeURIComponent(id));
  }

  function openFromHash() {
    var m = location.hash.match(/^#p=(.+)$/);
    if (m) openProduct(decodeURIComponent(m[1]), false);
  }

  function shareProduct(id) {
    var p = state.byId[id];
    var url = location.href.split('#')[0] + '#p=' + encodeURIComponent(id);
    var text = p.nombre + ' — ' + NF.money(NF.priceOf(p)) + ' / ' + NF.unitLabel(p.unidad);
    if (navigator.share) {
      navigator.share({ title: p.nombre, text: text, url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { toast('Enlace copiado'); });
    }
  }

  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2000);
  }

  // ---------- eventos ----------

  function bindEvents() {
    var searchTimer;
    $('#q').addEventListener('input', function (e) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.q = e.target.value.trim();
        if (state.catalog) renderMain();
      }, 120);
    });

    document.addEventListener('click', function (e) {
      var t = e.target.closest('button, a');
      if (!t) return;
      var d = t.dataset;
      if (d.add) {
        var p = state.byId[d.add];
        changeQty(d.add, 1);
        if (p && NF.isDecimalUnit(p.unidad)) toast('Agregado 1 ' + NF.unitLabel(p.unidad) + ' de ' + p.nombre);
      } else if (d.inc) {
        changeQty(d.inc, NF.step(state.byId[d.inc].unidad));
      } else if (d.dec) {
        changeQty(d.dec, -NF.step(state.byId[d.dec].unidad));
      } else if (d.open) {
        openProduct(d.open);
      } else if (d.share) {
        shareProduct(d.share);
      } else if ('cat' in d) {
        state.cat = d.cat;
        state.q = '';
        $('#q').value = '';
        $$('#chips .tab-cat').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.cat === state.cat)); });
        renderMain();
        var chip = $('#chips .tab-cat[aria-pressed="true"]');
        if (chip) chip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if ('close' in d) {
        var dlg = t.closest('dialog');
        if (dlg) dlg.close();
      }
    });

    $('#cart-button').addEventListener('click', function () {
      state.orderDone = false;
      renderCart();
      $('#cart-dialog').showModal();
    });

    $('#cart-dialog').addEventListener('change', function (e) {
      if (e.target.name === 'entrega') renderCart();
    });
    $('#cart-dialog').addEventListener('submit', function (e) {
      if (e.target.id === 'checkout') submitOrder(e);
    });

    $('#product-dialog').addEventListener('close', function () {
      if (/^#p=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    });

    // Cerrar los diálogos tocando fuera.
    $$('dialog').forEach(function (dlg) {
      dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    });

    window.addEventListener('hashchange', openFromHash);
  }

  init();
})();
