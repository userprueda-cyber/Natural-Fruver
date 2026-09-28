/* Natural Fruver — página de trabajadores. */
(function () {
  'use strict';

  var NF = window.NF;
  var esc = NF.escapeHtml;
  var PIN_KEY = 'nf_pin';
  var REFRESH_MS = 60 * 1000;
  var PHOTO_MAX = 800;

  var state = {
    pin: '',
    who: '',
    data: null,
    tab: 'pedidos',
    busy: {},
    knownPending: null,
    editing: null
  };

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  // ---------- API (o simulación en modo demostración) ----------

  function api(action, extra) {
    var body = Object.assign({ action: action, pin: state.pin }, extra || {});
    var req = NF.isDemo() ? demo.handle(body) : NF.post(body);
    return req.then(function (res) {
      if (!res || !res.ok) {
        var err = new Error((res && res.mensaje) || 'Error');
        err.code = res && res.error;
        throw err;
      }
      return res;
    });
  }

  var demo = {
    data: null,
    handle: function (body) {
      var self = this;
      var ready = this.data ? Promise.resolve() : NF.getCatalog().then(function (cat) { self.init(cat); });
      return ready.then(function () {
        return new Promise(function (resolve) { setTimeout(function () { resolve(self.run(body)); }, 250); });
      });
    },
    init: function (cat) {
      this.data = {
        ok: true,
        productos: cat.productos.map(function (p) {
          return Object.assign({}, p, { precio_oferta: p.oferta, disponible_marcado: p.stock === 0 ? true : p.disponible, archivado: false, actualizado: '', actualizado_por: 'ejemplo' });
        }),
        categorias: cat.categorias,
        unidades: ['kg', 'lb', 'unidad', 'atado', 'canasta', 'paquete', 'bandeja'],
        pedidos: [{
          nro: 'NF-0001', fecha: 'hoy 8:15', estado: 'pendiente', cliente: 'Cliente de ejemplo', telefono: '3000000000',
          entrega: 'domicilio', direccion: 'Cra 7 # 20-30, Centro', notas: 'Aguacates para hoy',
          items: [{ id: 'aguacate-hass', nombre: 'Aguacate Hass', unidad: 'unidad', cantidad: 3, precio: 2500, total: 7500 }],
          subtotal: 7500, domicilio: 4000, total: 11500
        }]
      };
    },
    find: function (id) {
      return this.data.productos.filter(function (p) { return p.id === id; })[0];
    },
    run: function (b) {
      var d = this.data;
      if (String(b.pin || '').length < 4) return { ok: false, error: 'pin', mensaje: 'PIN incorrecto.' };
      switch (b.action) {
        case 'admin_login': return { ok: true, nombre: 'Demo' };
        case 'admin_datos': return JSON.parse(JSON.stringify(d));
        case 'admin_guardar': {
          var input = b.producto;
          var p = input.id ? this.find(input.id) : null;
          if (!p) {
            p = { id: NF.normalize(input.nombre).replace(/ /g, '-') + '-' + Date.now(), archivado: false };
            d.productos.push(p);
          }
          Object.assign(p, input, { precio: Number(input.precio), actualizado: 'ahora', actualizado_por: 'Demo' });
          p.stock = input.stock === '' ? null : Number(input.stock);
          p.precio_oferta = input.precio_oferta ? Number(input.precio_oferta) : null;
          p.oferta = p.precio_oferta;
          p.disponible_marcado = !!input.disponible;
          p.disponible = p.disponible_marcado && (p.stock == null || p.stock > 0);
          p.destacado = !!input.destacado;
          p.foto = input.foto_url || '';
          p.palabras = input.palabras_clave || '';
          return { ok: true, id: p.id };
        }
        case 'admin_rapido': {
          var q = this.find(b.id);
          if ('disponible' in b.cambios) q.disponible_marcado = !!b.cambios.disponible;
          if ('stock' in b.cambios) q.stock = b.cambios.stock === '' ? null : Number(b.cambios.stock);
          q.disponible = q.disponible_marcado && (q.stock == null || q.stock > 0);
          return { ok: true, id: b.id };
        }
        case 'admin_archivar':
          this.find(b.id).archivado = b.archivar !== false;
          return { ok: true, id: b.id };
        case 'admin_foto':
          return { ok: true, url: b.dataUrl };
        case 'admin_pedido': {
          var o = d.pedidos.filter(function (x) { return x.nro === b.nro; })[0];
          o.estado = b.estado;
          return { ok: true, nro: b.nro, estado: b.estado };
        }
      }
      return { ok: false, error: 'accion', mensaje: 'Acción desconocida.' };
    }
  };

  // ---------- ingreso ----------

  function init() {
    $('#login-demo').hidden = !NF.isDemo();
    $('#admin-demo').hidden = !NF.isDemo();
    bindEvents();
    var saved = '';
    try { saved = sessionStorage.getItem(PIN_KEY) || ''; } catch (e) { /* sin almacenamiento */ }
    if (saved) login(saved, true);
    else showLogin();
  }

  function showLogin(msg) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    var err = $('#login-error');
    err.hidden = !msg;
    err.textContent = msg || '';
    $('#pin').focus();
  }

  function login(pin, silent) {
    state.pin = pin;
    return api('admin_login').then(function (res) {
      state.who = res.nombre;
      try { sessionStorage.setItem(PIN_KEY, pin); } catch (e) { /* sin almacenamiento */ }
      $('#who').textContent = res.nombre;
      $('#login').hidden = true;
      $('#app').hidden = false;
      return reload();
    }).catch(function (err) {
      try { sessionStorage.removeItem(PIN_KEY); } catch (e) { /* sin almacenamiento */ }
      showLogin(silent ? '' : err.message);
    });
  }

  function logout() {
    try { sessionStorage.removeItem(PIN_KEY); } catch (e) { /* sin almacenamiento */ }
    state.pin = '';
    state.data = null;
    $('#pin').value = '';
    showLogin();
  }

  // ---------- datos ----------

  function reload() {
    $('#reload').classList.add('spinning');
    return api('admin_datos').then(function (data) {
      state.data = data;
      notifyNewOrders();
      render();
    }).catch(handleError).then(function () {
      $('#reload').classList.remove('spinning');
    });
  }

  function handleError(err) {
    if (err && (err.code === 'pin' || err.code === 'bloqueado')) return logout();
    toast(err && err.message ? err.message : 'Sin conexión. Intenta de nuevo.', true);
  }

  function notifyNewOrders() {
    var pending = state.data.pedidos.filter(function (o) { return o.estado === 'pendiente'; }).map(function (o) { return o.nro; });
    if (state.knownPending) {
      var fresh = pending.filter(function (n) { return state.knownPending.indexOf(n) < 0; });
      if (fresh.length) {
        toast('Pedido nuevo: ' + fresh.join(', '));
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      }
    }
    state.knownPending = pending;
    document.title = (pending.length ? '(' + pending.length + ') ' : '') + 'Trabajadores — Natural Fruver';
  }

  function render() {
    renderOrders();
    renderProducts();
    var pending = state.data.pedidos.filter(function (o) { return o.estado === 'pendiente'; }).length;
    var count = $('#pending-count');
    count.hidden = !pending;
    count.textContent = pending;
  }

  // ---------- pedidos ----------

  var STATE_LABEL = { pendiente: 'Pendiente', confirmado: 'Confirmado', entregado: 'Entregado', cancelado: 'Cancelado' };

  function renderOrders() {
    var orders = state.data.pedidos;
    var open = orders.filter(function (o) { return o.estado === 'pendiente' || o.estado === 'confirmado'; });
    var closed = orders.filter(function (o) { return o.estado === 'entregado' || o.estado === 'cancelado'; });
    var html = open.length
      ? open.map(orderCard).join('')
      : '<div class="empty">' + NF.icon('basket', 'empty-icon') + '<p>No hay pedidos abiertos.</p><p class="fine">La lista se revisa sola cada minuto.</p></div>';
    if (closed.length) {
      html += '<details class="closed"><summary>Últimos pedidos cerrados (' + closed.length + ')</summary>' + closed.map(orderCard).join('') + '</details>';
    }
    $('#tab-pedidos').innerHTML = html;
  }

  function orderCard(o) {
    var phone = String(o.telefono || '').replace(/\D/g, '');
    if (phone.length === 10) phone = '57' + phone; // celular colombiano sin indicativo
    var actions = '';
    if (o.estado === 'pendiente') {
      actions = '<button class="btn primary" data-order="' + esc(o.nro) + '" data-to="confirmado">Confirmar</button>' +
        '<button class="btn danger" data-order="' + esc(o.nro) + '" data-to="cancelado">Cancelar</button>';
    } else if (o.estado === 'confirmado') {
      actions = '<button class="btn primary" data-order="' + esc(o.nro) + '" data-to="entregado">Entregado</button>' +
        '<button class="btn danger" data-order="' + esc(o.nro) + '" data-to="cancelado">Cancelar</button>';
    }
    var wa = NF.waLink(phone, 'Hola ' + o.cliente + ', te escribimos de Natural Fruver por tu pedido ' + o.nro);
    return '<article class="order is-' + esc(o.estado) + '">' +
      '<header class="order-head"><span class="order-nro">' + esc(o.nro) + '</span>' +
      '<span class="status">' + esc(STATE_LABEL[o.estado] || o.estado) + '</span><time>' + esc(o.fecha) + '</time></header>' +
      '<div class="order-who"><strong>' + esc(o.cliente) + '</strong>' +
      '<a class="order-phone" href="' + wa + '" target="_blank" rel="noopener" aria-label="Escribir a ' + esc(o.cliente) + ' por WhatsApp">' +
      NF.icon('whatsapp-logo') + esc(o.telefono) + '</a></div>' +
      '<p class="order-meta">' + (o.entrega === 'domicilio'
        ? NF.icon('moped') + '<span>' + esc(o.direccion) + '</span>'
        : NF.icon('storefront') + '<span>Recoge en la tienda</span>') + '</p>' +
      (o.notas ? '<p class="order-meta order-note">' + NF.icon('note-pencil') + '<span>' + esc(o.notas) + '</span></p>' : '') +
      '<div class="order-items">' + o.items.map(function (l) {
        return NF.leaderRow('<b>' + NF.qty(l.cantidad) + ' ' + esc(NF.unitLabel(l.unidad)) + '</b> ' + esc(l.nombre), NF.money(l.total));
      }).join('') +
      (o.domicilio ? NF.leaderRow('Domicilio', NF.money(o.domicilio), 'is-sub') : '') +
      NF.leaderRow('Total', NF.money(o.total), 'is-total') + '</div>' +
      (actions ? '<div class="actions">' + actions + '</div>' : '') +
      (o.actualizado_por && o.estado !== 'pendiente' ? '<p class="fine order-by">Actualizado por ' + esc(o.actualizado_por) + '</p>' : '') +
      '</article>';
  }

  function setOrderState(nro, estado, btn) {
    if (estado === 'cancelado' && !confirm('¿Cancelar el pedido ' + nro + '? Los productos vuelven al inventario.')) return;
    btn.disabled = true;
    btn.classList.add('loading');
    api('admin_pedido', { nro: nro, estado: estado }).then(function () {
      toast('Pedido ' + nro + ': ' + STATE_LABEL[estado].toLowerCase());
      return reload();
    }).catch(function (err) {
      handleError(err);
      reload();
    });
  }

  // ---------- productos ----------

  function lowThreshold() {
    return state.data.stock_minimo != null ? state.data.stock_minimo : 2;
  }

  function filteredProducts() {
    var list = state.data.productos;
    var f = $('#pfilter').value;
    list = list.filter(function (p) {
      if (f === 'archivados') return p.archivado;
      if (p.archivado) return false;
      if (f === 'agotados') return !p.disponible;
      if (f === 'ofertas') return p.oferta != null;
      if (f === 'poco') return p.stock != null && p.stock <= lowThreshold();
      return true;
    });
    var q = $('#pq').value.trim();
    return q ? NF.search(list, q) : list;
  }

  function renderProducts() {
    var list = filteredProducts();
    $('#plist').innerHTML = list.length ? list.map(productRow).join('') : '<li class="empty"><p>No hay productos aquí.</p></li>';
  }

  function thumbHtml(p) {
    if (p.foto) return '<img src="' + esc(p.foto) + '" alt="" loading="lazy" width="56" height="56">';
    var t = NF.placeholderTile(p);
    return '<span class="ph" style="--h:' + t.hue + '"><span class="ph-initial">' + esc(t.initial) + '</span></span>';
  }

  function productRow(p) {
    var name = esc(p.nombre);
    var price = (p.oferta != null ? '<s class="was">' + NF.money(p.precio) + '</s> ' : '') +
      '<span class="tag tag-sm' + (p.oferta != null ? ' is-sale' : '') + '"><strong>' + NF.money(NF.priceOf(p)) + '</strong>' +
      '<span class="unit">/' + esc(NF.unitLabel(p.unidad)) + '</span></span>';
    var stock = p.stock != null
      ? '<div class="mini-stepper' + (p.stock <= lowThreshold() ? ' low' : '') + '">' +
        '<button type="button" data-stock="' + esc(p.id) + '" data-delta="-1" aria-label="Restar a ' + name + '">' + NF.icon('minus') + '</button>' +
        '<span>' + NF.qty(p.stock) + ' ' + esc(NF.unitLabel(p.unidad)) + '</span>' +
        '<button type="button" data-stock="' + esc(p.id) + '" data-delta="1" aria-label="Sumar a ' + name + '">' + NF.icon('plus') + '</button></div>'
      : '<small class="muted no-count">Sin conteo</small>';
    var toggle = p.archivado
      ? '<button type="button" class="btn small" data-unarchive="' + esc(p.id) + '">Restaurar</button>'
      : '<label class="switch"><input type="checkbox" role="switch" data-toggle="' + esc(p.id) + '"' + (p.disponible_marcado ? ' checked' : '') +
        ' aria-label="' + name + ' disponible"><span aria-hidden="true"></span></label>';
    return '<li class="prow' + (p.disponible ? '' : ' is-out') + '" data-id="' + esc(p.id) + '">' +
      '<button type="button" class="prow-main" data-edit="' + esc(p.id) + '" aria-label="Editar ' + name + '">' + thumbHtml(p) +
      '<span class="prow-text"><span class="prow-name">' + name + '</span>' +
      '<span class="prow-price">' + price + '</span>' +
      (p.disponible ? '' : '<span class="prow-flag">No disponible</span>') + '</span></button>' +
      '<div class="prow-side">' + toggle + stock + '</div></li>';
  }

  function productById(id) {
    return state.data.productos.filter(function (p) { return p.id === id; })[0];
  }

  function quick(id, changes, revert) {
    state.busy[id] = true;
    api('admin_rapido', { id: id, cambios: changes }).then(function () {
      delete state.busy[id];
    }).catch(function (err) {
      delete state.busy[id];
      revert();
      renderProducts();
      handleError(err);
    });
  }

  function toggleAvailable(id, on) {
    var p = productById(id);
    var before = { m: p.disponible_marcado, d: p.disponible };
    p.disponible_marcado = on;
    p.disponible = on && (p.stock == null || p.stock > 0);
    renderProducts();
    toast(p.nombre + (on ? ' disponible' : ' no disponible'));
    quick(id, { disponible: on }, function () { p.disponible_marcado = before.m; p.disponible = before.d; });
  }

  // Los toques seguidos en +/− se envían juntos después de una pausa corta.
  var stockTimers = {};
  function bumpStock(id, delta) {
    var p = productById(id);
    var original = p._stockOriginal != null ? p._stockOriginal : p.stock;
    p._stockOriginal = original;
    p.stock = Math.max(0, Math.round((p.stock + delta * NF.step(p.unidad)) * 100) / 100);
    p.disponible = p.disponible_marcado && p.stock > 0;
    renderProducts();
    clearTimeout(stockTimers[id]);
    stockTimers[id] = setTimeout(function () {
      delete stockTimers[id];
      var value = p.stock;
      delete p._stockOriginal;
      quick(id, { stock: value }, function () { p.stock = original; p.disponible = p.disponible_marcado && p.stock > 0; });
    }, 700);
  }

  // ---------- editar / crear ----------

  function openEditor(id) {
    var p = id ? productById(id) : null;
    state.editing = p;
    var f = $('#edit-form');
    f.reset();
    $('#edit-title').textContent = p ? 'Editar producto' : 'Nuevo producto';
    $('#edit-error').hidden = true;
    $('#cat-list').innerHTML = state.data.categorias.map(function (c) { return '<option value="' + esc(c.nombre) + '">'; }).join('');
    $('#unit-select').innerHTML = state.data.unidades.map(function (u) { return '<option value="' + esc(u) + '">' + esc(u) + '</option>'; }).join('');

    f.id.value = p ? p.id : '';
    f.nombre.value = p ? p.nombre : '';
    f.categoria.value = p ? p.categoria : '';
    f.precio.value = p ? p.precio : '';
    f.unidad.value = p ? p.unidad : 'kg';
    f.precio_oferta.value = p && p.precio_oferta ? p.precio_oferta : '';
    f.oferta_hasta.value = p ? p.oferta_hasta || '' : '';
    f.disponible.checked = p ? p.disponible_marcado : true;
    f.destacado.checked = p ? p.destacado : false;
    $('#track-stock').checked = !!(p && p.stock != null);
    f.stock.value = p && p.stock != null ? p.stock : '';
    f.descripcion.value = p ? p.descripcion : '';
    f.palabras_clave.value = p ? p.palabras : '';
    f.orden.value = p && p.orden !== 999 ? p.orden : '';
    f.foto_url.value = p ? p.foto : '';
    updatePct();
    updateStockField();
    showPhoto(f.foto_url.value);
    $('#photo-status').textContent = '';
    $('#archive-product').hidden = !p || p.archivado;
    $('#edit-meta').textContent = p && p.actualizado ? 'Última edición: ' + p.actualizado + ' por ' + p.actualizado_por : '';
    $('#edit-dialog').showModal();
    if (!p) f.nombre.focus();
  }

  function updatePct() {
    var f = $('#edit-form');
    var price = Number(f.precio.value);
    var sale = Number(f.precio_oferta.value);
    $('#pct').value = price > 0 && sale > 0 && sale < price ? Math.round((1 - sale / price) * 100) : '';
  }

  function applyPct() {
    var f = $('#edit-form');
    var price = Number(f.precio.value);
    var pct = Number($('#pct').value);
    f.precio_oferta.value = price > 0 && pct > 0 && pct < 100 ? Math.round(price * (1 - pct / 100) / 50) * 50 : '';
  }

  function updateStockField() {
    var on = $('#track-stock').checked;
    $('#stock-field').hidden = !on;
    if (on && $('#edit-form').stock.value === '') $('#edit-form').stock.value = 0;
  }

  function showPhoto(url) {
    var el = $('#photo-preview');
    var f = $('#edit-form');
    var t = NF.placeholderTile({ nombre: f.nombre.value || '?', categoria: f.categoria.value || '' });
    el.innerHTML = url ? '<img src="' + esc(url) + '" alt="">' : '<span class="ph" style="--h:' + t.hue + '"><span class="ph-initial">' + esc(t.initial) + '</span></span>';
    $('#photo-remove').hidden = !url;
  }

  function saveProduct(e) {
    e.preventDefault();
    var f = $('#edit-form');
    var err = $('#edit-error');
    var producto = {
      nombre: f.nombre.value.trim(),
      categoria: f.categoria.value.trim(),
      precio: f.precio.value,
      unidad: f.unidad.value,
      precio_oferta: f.precio_oferta.value,
      oferta_hasta: f.precio_oferta.value ? f.oferta_hasta.value : '',
      disponible: f.disponible.checked,
      destacado: f.destacado.checked,
      stock: $('#track-stock').checked ? f.stock.value || 0 : '',
      descripcion: f.descripcion.value.trim(),
      palabras_clave: f.palabras_clave.value.trim(),
      orden: f.orden.value,
      foto_url: f.foto_url.value
    };
    if (f.id.value) producto.id = f.id.value;
    if (producto.nombre.length < 2) return showError(err, 'Escribe el nombre.');
    if (!(Number(producto.precio) > 0)) return showError(err, 'Escribe el precio.');
    if (producto.precio_oferta && Number(producto.precio_oferta) >= Number(producto.precio)) {
      return showError(err, 'El precio de oferta debe ser menor que el precio normal.');
    }
    err.hidden = true;
    var btn = $('#save-product');
    btn.disabled = true;
    btn.classList.add('loading');
    api('admin_guardar', { producto: producto }).then(function () {
      $('#edit-dialog').close();
      toast('Guardado: ' + producto.nombre);
      return reload();
    }).catch(function (e2) {
      if (e2.code === 'pin') return handleError(e2);
      showError(err, e2.message || 'No se pudo guardar.');
    }).then(function () {
      btn.disabled = false;
      btn.classList.remove('loading');
    });
  }

  function showError(el, msg) {
    el.textContent = msg;
    el.hidden = false;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function archive(id, on) {
    var p = productById(id);
    if (on && !confirm('¿Archivar "' + p.nombre + '"? Deja de verse en la tienda (puedes restaurarlo en el filtro "Archivados").')) return;
    api('admin_archivar', { id: id, archivar: on }).then(function () {
      if ($('#edit-dialog').open) $('#edit-dialog').close();
      toast(on ? 'Archivado: ' + p.nombre : 'Restaurado: ' + p.nombre);
      return reload();
    }).catch(handleError);
  }

  // Reduce la foto en el celular antes de subirla (más rápida y liviana).
  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, PHOTO_MAX / Math.max(img.width, img.height));
        var side = Math.min(img.width, img.height);
        // Recorte cuadrado centrado: las tarjetas de la tienda son cuadradas.
        var size = Math.round(side * scale);
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la foto.')); };
      img.src = url;
    });
  }

  function uploadPhoto(file) {
    var status = $('#photo-status');
    var save = $('#save-product');
    status.textContent = 'Subiendo foto…';
    save.disabled = true;
    resizeImage(file).then(function (dataUrl) {
      showPhoto(dataUrl);
      return api('admin_foto', { dataUrl: dataUrl, nombre: $('#edit-form').nombre.value || 'producto' });
    }).then(function (res) {
      $('#edit-form').foto_url.value = res.url;
      status.textContent = 'Foto lista. Toca "Guardar".';
    }).catch(function (err) {
      showPhoto($('#edit-form').foto_url.value);
      status.textContent = err.message || 'No se pudo subir la foto.';
    }).then(function () {
      save.disabled = false;
    });
  }

  // ---------- interfaz ----------

  function setTab(tab) {
    state.tab = tab;
    $$('.tabs [role="tab"]').forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.tab === tab)); });
    $('#tab-pedidos').hidden = tab !== 'pedidos';
    $('#tab-productos').hidden = tab !== 'productos';
    $('#new-product').hidden = tab !== 'productos';
    document.body.classList.toggle('has-cart', tab === 'productos');
  }

  function toast(msg, isError) {
    var el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, isError ? 4000 : 2200);
  }

  function bindEvents() {
    $('#login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.classList.add('loading');
      login($('#pin').value.trim()).then(function () {
        btn.disabled = false;
        btn.classList.remove('loading');
      });
    });
    $('#logout').addEventListener('click', logout);
    $('#reload').addEventListener('click', reload);
    $('#new-product').addEventListener('click', function () { openEditor(null); });
    $('#pq').addEventListener('input', renderProducts);
    $('#pfilter').addEventListener('change', renderProducts);

    document.addEventListener('click', function (e) {
      var t = e.target.closest('button, [data-tab]');
      if (!t) return;
      var d = t.dataset;
      if (d.tab) setTab(d.tab);
      else if (d.order) setOrderState(d.order, d.to, t);
      else if (d.edit) openEditor(d.edit);
      else if (d.stock) bumpStock(d.stock, Number(d.delta));
      else if (d.unarchive) archive(d.unarchive, false);
      else if ('close' in d) t.closest('dialog').close();
    });

    document.addEventListener('change', function (e) {
      if (e.target.dataset && e.target.dataset.toggle) toggleAvailable(e.target.dataset.toggle, e.target.checked);
    });

    var f = $('#edit-form');
    f.addEventListener('submit', saveProduct);
    f.precio.addEventListener('input', updatePct);
    f.precio_oferta.addEventListener('input', updatePct);
    $('#pct').addEventListener('input', applyPct);
    $('#track-stock').addEventListener('change', updateStockField);
    $('#photo-input').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) uploadPhoto(e.target.files[0]);
      e.target.value = '';
    });
    $('#photo-remove').addEventListener('click', function () {
      f.foto_url.value = '';
      showPhoto('');
    });
    $('#archive-product').addEventListener('click', function () { archive(f.id.value, true); });
    $('#edit-dialog').addEventListener('click', function (e) { if (e.target === e.currentTarget) e.currentTarget.close(); });

    // Revisar pedidos nuevos cada minuto mientras la página está abierta.
    setInterval(function () {
      if (state.data && !document.hidden && !$('#edit-dialog').open && !Object.keys(state.busy).length && !Object.keys(stockTimers).length) reload();
    }, REFRESH_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.data) reload();
    });
  }

  init();
})();
