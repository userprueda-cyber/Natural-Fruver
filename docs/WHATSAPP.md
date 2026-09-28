# Conectar el bot de WhatsApp

Los clientes piden todo por WhatsApp: ven el catálogo con fotos y precios, arman el
carrito de WhatsApp, eligen domicilio o recoger y confirman. El pedido queda en la
hoja (pestaña **Pedidos**), el inventario baja solo y a los trabajadores les llega
un aviso con botones para confirmar o cancelar.

```
Cliente (WhatsApp) ──► Meta ──► Relé (Cloudflare, gratis) ──► Apps Script ──► Google Sheet
        ▲                                                         │
        └──────────── respuestas, catálogo, avisos ◄──────────────┘
```

Necesitas (una sola vez, ~1 hora):

- La hoja ya configurada (pasos de `docs/GUIA.md` hasta "Implementar como aplicación web").
- La app **WhatsApp Business** actualizada en el celular de la tienda, con el número 313 596 2382.
- Una cuenta de Facebook del dueño y una cuenta de **Meta Business** (business.facebook.com).
- Una cuenta gratis de **Cloudflare** (dash.cloudflare.com).

> Los nombres de los menús de Meta cambian seguido. Si algo no aparece igual,
> busca el nombre en inglés entre paréntesis.

## 1. Crear la app de Meta

1. Entra a **developers.facebook.com** → *Mis apps* → *Crear app*.
2. Tipo: **Empresa** (*Business*). Asóciala a la cuenta de Meta Business de la tienda.
3. En la app, agrega el producto **WhatsApp** (*Configurar*).
4. En *Configuración de la app → Básica* copia la **Clave secreta de la app** (*App Secret*). La usarás en el paso 5.

## 2. Conectar el número actual (coexistencia)

Así el número sigue funcionando en la app WhatsApp Business del celular **y** el bot responde.
Todo lo que el bot envía y recibe también se ve en la app.

1. En la app de Meta → *WhatsApp → Configuración de la API* (*API Setup*) → *Agregar número de teléfono*.
2. Elige **Conectar tu app WhatsApp Business existente** (*Connect your existing WhatsApp Business app*).
3. Sigue los pasos: en el celular, WhatsApp Business te muestra un código QR o un aviso para aprobar la conexión.
4. Cuando termine, en *Configuración de la API* copia el **Identificador del número de teléfono** (*Phone number ID*). **No** es el número: es una cifra larga.

## 3. Crear el catálogo

1. Entra a **business.facebook.com/commerce** (*Commerce Manager*) → *Agregar catálogo*.
2. Tipo **Comercio electrónico** → *Subir información de productos* → nombre "Natural Fruver". No agregues productos: el script los sube solo.
3. Copia el **Identificador del catálogo** (*Catalog ID*, en *Configuración del catálogo*).
4. En **WhatsApp Manager** → *Herramientas de la cuenta → Catálogo*: elige ese catálogo.
   Activa **Mostrar catálogo** y **Habilitar carrito**.

## 4. Token permanente

1. **business.facebook.com/settings** → *Usuarios → Usuarios del sistema* → *Agregar* (rol **Administrador**), nombre "bot".
2. *Asignar activos*: la **app**, la **cuenta de WhatsApp** y el **catálogo**, con control total.
3. *Generar token*: elige la app, vencimiento **Nunca**, y marca los permisos
   `whatsapp_business_messaging`, `whatsapp_business_management` y `catalog_management`.
4. Copia el token. Solo se muestra una vez. **No lo compartas ni lo pegues en la hoja.**

## 5. Datos secretos en Apps Script

1. En la hoja: *Extensiones → Apps Script → Configuración del proyecto* (engranaje) → **Propiedades del script**.
2. Agrega:

   | Propiedad | Valor |
   |---|---|
   | `WA_TOKEN` | el token del paso 4 |
   | `WA_PHONE_ID` | el identificador del número (paso 2) |
   | `WA_CATALOG_ID` | el identificador del catálogo (paso 3) |

   `RELAY_SECRET` ya existe: la creó *Configurar hojas*. Cópiala para el paso 6.
3. *Implementar → Gestionar implementaciones → editar (lápiz) → Versión: Nueva versión → Implementar*.
   Acepta el permiso nuevo ("conectarse a un servicio externo").
4. En la hoja, menú **Natural Fruver → Sincronizar catálogo de WhatsApp**. Debe decir "… productos enviados".
   En Commerce Manager verás los productos (Meta los revisa; puede tardar unas horas).
5. Menú **Natural Fruver → Activar tareas automáticas** otra vez: agrega la sincronización cada hora.

## 6. El relé en Cloudflare

En un computador con Node.js, en la carpeta del proyecto:

```bash
cd relay
npx wrangler login
npx wrangler deploy
npx wrangler secret put APPS_SCRIPT_URL   # la URL de la aplicación web (termina en /exec)
npx wrangler secret put RELAY_SECRET      # la de Propiedades del script
npx wrangler secret put APP_SECRET        # la Clave secreta de la app (paso 1)
npx wrangler secret put VERIFY_TOKEN      # inventa una palabra larga, p. ej. fruver-2026-xyz
```

`wrangler deploy` muestra la dirección del relé, algo como
`https://natural-fruver-whatsapp.<tu-cuenta>.workers.dev`.

## 7. Webhook

1. En la app de Meta → *WhatsApp → Configuración* (*Configuration*) → *Webhook → Editar*.
2. **URL de devolución de llamada**: la dirección del relé. **Token de verificación**: el `VERIFY_TOKEN`.
3. *Verificar y guardar*. Luego en *Campos del webhook* suscríbete a **messages**.

## 8. Trabajadores

1. Pestaña **Trabajadores**: en la columna `whatsapp` escribe el celular de cada uno (ej. `3004445566`).
2. Cada trabajador escribe **hola** al WhatsApp de la tienda: le llega la lista de comandos.

Meta solo deja escribirle libremente a alguien que te escribió en las últimas 24 horas.
Para que los avisos de pedidos siempre lleguen:

- **Fácil:** cada trabajador escribe *hola* al bot al empezar el turno.
- **Siempre:** crea una plantilla en *WhatsApp Manager → Plantillas de mensajes*, categoría **Utilidad**,
  nombre `aviso_pedido`, idioma español, texto:
  `Nuevo pedido {{1}} de {{2}} por {{3}}. Escribe "pedidos" para verlo.`
  Cuando Meta la apruebe, escribe `aviso_pedido` en Config → `plantilla_aviso_pedido`.

### Comandos

| Escribe | Qué hace |
|---|---|
| `pedidos` | pedidos abiertos |
| `pedido 12` | detalle del NF-0012, con botones |
| `confirmar 12` · `entregado 12` · `cancelar 12` | cambia el estado y avisa al cliente |
| `ver mango` | busca un producto |
| `precio mango 5500` | cambia el precio |
| `oferta mango 5000` · `oferta mango 5000 hasta 15/10` · `oferta mango quitar` | ofertas |
| `stock mango 20` · `stock mango +5` · `stock mango no` | inventario (`no` = no contar) |
| `agotado fresa` · `disponible fresa` | prender / apagar un producto |
| `comprar` | usar el bot como cliente (para probar) |

Los cambios pasan al catálogo de WhatsApp enseguida. Si editas la hoja a mano, se
sincroniza en la siguiente hora (o usa el menú *Sincronizar catálogo de WhatsApp*).

## 9. Probar

Desde un celular que **no** sea trabajador, escribe *hola* al número de la tienda:
menú → *Hacer pedido* → una categoría → agrega productos al carrito → *Enviar* →
domicilio → dirección → nombre → *Confirmar*. Revisa la pestaña Pedidos.

## Costos

- **Google** (hoja y Apps Script) y **Cloudflare** (relé): gratis para el volumen de una tienda.
- **Meta:** responder a clientes que escriben primero no tiene costo. Las plantillas (el aviso
  opcional a trabajadores) tienen un costo pequeño por mensaje. Revisa los precios vigentes en
  la página de precios de WhatsApp Business Platform antes de activarlas.

## Límites que conviene saber

- **Cantidades enteras:** el carrito de WhatsApp solo maneja 1, 2, 3… Los productos por kg se
  piden en kilos enteros; el cliente puede pedir otra cantidad en la nota.
- **Cerveza:** Meta no permite bebidas alcohólicas en catálogos de WhatsApp. Las cervezas
  quedan en la hoja con `en_whatsapp = no` y no se muestran.
- **Fotos:** Meta pide fotos de al menos 500×500. Las de `site/img/productos` son de 600×600 y
  se publican en `url_fotos` (Config). Las fotos que suban los trabajadores quedan en Drive.
- **Revisión de Meta:** los productos nuevos pueden tardar en aparecer mientras Meta los revisa.
