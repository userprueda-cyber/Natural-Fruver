# Guía de Natural Fruver: catálogo en línea

Esta guía explica cómo poner en marcha el catálogo (una sola vez) y cómo usarlo en el día a día.

- **Clientes**: abren la página, buscan productos, arman su pedido y lo envían por WhatsApp.
- **Trabajadores**: desde el celular agregan productos, cambian precios y ofertas, marcan agotados y atienden los pedidos.
- **Todo queda en una hoja de Google Sheets** que el dueño puede abrir cuando quiera.
- **Costo: $0.** Solo es opcional comprar un dominio propio (unos $60.000 al año).

---

## 1. Puesta en marcha (una sola vez, ~20 minutos)

Usa la **cuenta de Google de la tienda**: será la dueña de la hoja, de las fotos y de los pedidos.

### 1.1 Crear la hoja y pegar el código
1. Entra a [sheets.new](https://sheets.new) y ponle de nombre **Natural Fruver**.
2. Menú **Extensiones → Apps Script**.
3. En el editor que se abre:
   - Borra el contenido de `Código.gs`.
   - Crea un archivo por cada `.gs` de la carpeta `apps-script/` de este proyecto (`Api`, `Catalog`, `Orders`, `Admin`, `Jobs`, `Setup`, `Util`) y pega su contenido. El botón **＋** junto a "Archivos" crea uno nuevo.
   - En **Configuración del proyecto** (el engranaje), activa *"Mostrar el archivo de manifiesto appsscript.json"*. Luego abre `appsscript.json` y reemplázalo por el de este proyecto.
4. Guarda con el ícono 💾.

### 1.2 Crear las pestañas
1. Vuelve a la hoja y **recárgala** (F5). Aparece un menú nuevo: **Natural Fruver**.
2. Haz clic en **Natural Fruver → 1. Configurar hojas (primera vez)**.
3. Google pide permisos. Acéptalos: *Revisar permisos → tu cuenta → Configuración avanzada → Ir a … (no seguro) → Permitir*. El aviso sale porque el código es tuyo y no está publicado por Google.
4. Se crean las pestañas con productos de ejemplo. **Anota el PIN del Administrador** que aparece en pantalla.

### 1.3 Llenar la configuración
Abre la pestaña **Config** y completa como mínimo:

| clave | ejemplo | qué es |
|---|---|---|
| `whatsapp` | `573001234567` | Número que recibe los pedidos: 57 + celular, sin espacios ni + |
| `horario` | `lun-sab 07:00-19:00; dom 08:00-13:00` | La página muestra "Abierto" o "Cerrado" con este horario |
| `direccion_tienda` | `Cra 8 # 20-15, Pereira` | |
| `domicilio_valor` | `4000` | Valor del domicilio (0 = gratis) |
| `domicilio_gratis_desde` | `60000` | Domicilio gratis desde este valor (0 = nunca) |
| `pedido_minimo` | `0` | Pedido mínimo (0 = sin mínimo) |
| `banner` | `¡Martes de verduras: 20% off!` | Mensaje destacado arriba (vacío = nada) |
| `horas_cancelar_pendientes` | `3` | Pedidos no confirmados en ese tiempo se cancelan solos y los productos vuelven al inventario |
| `correo_resumen` | `tienda@gmail.com` | Correo que recibe un resumen cada mañana (vacío = no se envía) |

### 1.4 Publicar la conexión (aplicación web)
1. En Apps Script: botón azul **Implementar → Nueva implementación**.
2. Tipo (engranaje): **Aplicación web**.
3. *Ejecutar como*: **Yo**. *Quién tiene acceso*: **Cualquier persona**.
4. **Implementar** y copia la **URL de la aplicación web** (termina en `/exec`).
5. En la hoja: **Natural Fruver → 2. Activar tareas automáticas**.

### 1.5 Conectar la página
1. En este proyecto, abre `site/js/config.js` y pega la URL:
   ```js
   window.NF_CONFIG = { API_URL: 'https://script.google.com/macros/s/XXXX/exec' };
   ```
2. En GitHub: **Settings → Pages → Source: GitHub Actions**. Al subir los cambios a `main`, la página se publica sola.
3. Pon el enlace en la **biografía de Instagram** y en el **perfil de WhatsApp Business**.

> Si más adelante cambias el código de Apps Script: **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar**. Así la URL sigue siendo la misma.

---

## 2. Uso diario: trabajadores

Abre **`…/admin.html`** en el celular. Consejo: en el navegador toca *"Agregar a pantalla de inicio"* para tenerla como una app.

Entra con tu **PIN**. Cada trabajador debe tener el suyo en la pestaña *Trabajadores* (columnas `nombre`, `pin`, `activo`), así queda registrado quién hizo cada cambio.

### Pedidos
- Los pedidos nuevos aparecen arriba en **Pendiente** (borde naranja). La lista se actualiza sola cada minuto y el celular vibra con un pedido nuevo.
- El cliente también te escribe por WhatsApp con el mismo número de pedido (ej. `NF-0042`).
- **Confirmar** cuando lo aceptas → **Entregado** cuando sale o lo recogen.
- **Cancelar** si no se puede atender: **los productos vuelven al inventario**.
- Si nadie confirma un pedido en 3 horas (configurable), se cancela solo.
- Toca el teléfono del cliente para escribirle por WhatsApp.

### Productos
- **Interruptor verde**: disponible / no disponible. Es lo más rápido para marcar algo como agotado.
- **− / +**: ajusta la cantidad en tienda (solo para productos donde se controla la cantidad).
- **Toca el producto** para editarlo: nombre, precio, unidad, foto, oferta, descripción.
- **＋ Nuevo producto**: completa nombre, precio y unidad; lo demás es opcional.
- **Foto**: *Tomar / subir foto* abre la cámara. La foto se recorta cuadrada y se reduce sola.
- **Oferta**: escribe el precio de oferta **o** el % de descuento, y si quieres, hasta qué fecha. Al pasar la fecha la oferta desaparece sola.
- **Controlar cantidad**: actívalo si quieres que cada pedido descuente del inventario. Para productos que se venden por kilo y no se pesan exactos, déjalo apagado y usa solo el interruptor.
- **Archivar**: oculta el producto sin borrarlo. Se recupera en el filtro *Archivados*.

---

## 3. Uso diario: dueño (la hoja)

Todo se puede editar directamente en la hoja; la página toma los cambios en unos minutos.

- **Productos**: una fila por producto. En la columna `disponible` escribe `si` o `no`. Deja `stock` vacío si no quieres controlar la cantidad.
- **Categorias**: nombre, emoji y orden de las categorías.
- **Pedidos**: historial completo, útil para sacar cuentas con filtros o tablas dinámicas.
- **Trabajadores**: agrega o quita PINs. Pon `activo = no` para bloquear a alguien.
- Menú **Natural Fruver → Actualizar catálogo ahora** si quieres ver un cambio al instante.

Para cargar muchos productos de una vez, pégalos en la pestaña *Productos* respetando las columnas. Necesitan al menos `id` (una palabra sin espacios, ej. `mango-tommy`), `nombre`, `categoria`, `precio` y `unidad`.

---

## 4. Preguntas frecuentes

**¿Qué pasa si el cliente arma el pedido pero no envía el WhatsApp?**
El pedido queda *Pendiente* y los productos separados. Si nadie lo confirma en las horas configuradas, se cancela solo y el inventario vuelve.

**¿Y si alguien hace pedidos falsos?**
Se cancelan solos por la misma regla. Además, la página tiene una trampa para robots y el precio siempre se calcula en la hoja, no en el celular del cliente.

**Olvidé mi PIN / alguien se fue de la tienda.**
El dueño lo cambia o pone `activo = no` en la pestaña *Trabajadores*.

**Dice "Demasiados intentos".**
Después de 10 PIN incorrectos, la página de trabajadores se bloquea 10 minutos.

**¿Dónde quedan las fotos?**
Las que suben los trabajadores quedan en la carpeta *Natural Fruver - Fotos del catálogo* del Google Drive de la tienda.
Las fotos iniciales, recortadas del catálogo de Instagram, vienen con la página (`site/img/productos/`).
Si la hoja se creó antes de tener esas fotos, usa el menú *Natural Fruver → Agregar fotos del catálogo*. Solo llena los productos que no tienen foto.
