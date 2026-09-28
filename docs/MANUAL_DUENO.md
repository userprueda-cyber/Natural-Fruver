# Manual del asistente de WhatsApp — Natural Fruver

Una página para el dueño y los trabajadores. Todo se maneja desde WhatsApp o desde la hoja de Google.

## ¿Qué hace el asistente?
- Responde a los clientes a cualquier hora: horario, dirección, domicilios, precios y si hay un producto.
- Toma pedidos escritos como la gente escribe ("me regala 2 lbs d tomate y 3 aguacates xfa") o desde el catálogo de WhatsApp.
- Pregunta cuando no está seguro ("¿Tomate chonto o milano?"). **Nunca inventa precios ni productos.**
- Arma el pedido, pide dirección, nombre y forma de pago, y le muestra el resumen al cliente para que confirme.
- Te avisa de cada pedido nuevo con botones ✅ Confirmar / ❌ Cancelar.
- Le pasa el chat a una persona cuando el cliente la pide, está molesto, tiene una queja, manda una foto o un comprobante de pago, o cuando no le entiende.

## Lo que el asistente NO hace
- No confirma pagos: **tú revisas en Nequi o en el banco**. Los pantallazos se falsifican fácil.
- No da descuentos, no negocia, no da consejos de salud.
- No habla de temas que no son de la tienda.
- No escribe a nadie que no le haya escrito (nada de publicidad).

## Comandos (escríbelos al WhatsApp de la tienda desde tu número de trabajador)
| Escribe | Qué pasa |
|---|---|
| `ayuda` | Lista de comandos |
| `pedidos` | Pedidos abiertos |
| `pedido 12` | Ver el pedido NF-0012 con botones |
| `confirmar 12` · `preparando 12` · `en camino 12` · `entregado 12` · `cancelar 12` | Cambia el estado y le avisa al cliente |
| `deshacer 12` | Te equivocaste de estado: lo devuelve (dentro de 30 min, sin avisar al cliente) |
| `precio mango 5500` | Cambia el precio |
| `oferta mango 5000 hasta 15/10` · `oferta mango quitar` | Ofertas |
| `agotado fresa` · `disponible fresa` | Prende / apaga un producto |
| `stock mango 20` · `stock mango +5` | Inventario |
| `asesor` | Clientes esperando una persona |
| `tomar 3001234567` | Tú atiendes a ese cliente; el bot se calla con él |
| `devolver 3001234567` | El bot vuelve a atenderlo |
| `responder 3001234567 Hola, ya te ayudo` | Escribirle al cliente a través del bot |
| `hoy` | Resumen del día (pedidos, ventas, costo) |
| `sinresolver` | Lo que los clientes preguntaron y el bot no entendió |
| `pausar` / `reanudar` | **Apagar / prender el bot** para todos |
| `bloquear 3001234567` | El bot deja de responderle a ese número |

Si contestas a un cliente **directamente desde la app de WhatsApp Business**, el bot lo nota y se queda callado en ese chat
(durante 2 horas sin mensajes tuyos, luego vuelve).

## Cuando te llega "🙋 Cliente para atender"
1. Lee el motivo y los últimos mensajes.
2. Toca **🙋 Yo lo atiendo** y respóndele desde la app.
3. Cuando termines, toca **🤖 Devolver al bot** o escribe `devolver <número>`.
Si nadie lo atiende en 10 minutos, se avisa al número de respaldo y al cliente se le dice que sigue en la fila.

## La hoja de Google
- **Productos**: nombre, precio, unidad, disponible, stock. La columna **alias** sirve para los nombres que usan los clientes
  (ej. para *Cebolla larga*: "cebolla junca, cebollín"). Si en `sinresolver` ves un nombre que no entendió, agrégalo aquí.
- **Config**: horario, domicilio, formas de pago, datos de pago, políticas. **Lo que dejes vacío, el bot no lo promete**:
  dice "una persona te confirma".
- **Pedidos**, **Clientes**, **Uso** (costo de IA), **SinResolver**, **Registro** (quién cambió qué).

## Si el bot hace algo raro
1. Escribe **pausar**. Los clientes quedan para personas.
2. Llama al desarrollador: [[nombre y teléfono del desarrollador]].
3. Cuando esté resuelto, escribe **reanudar**.

## Costos (aproximados)
- WhatsApp: desde el 1 de oct. 2026, Meta cobra las respuestas del bot después de 1.000 al mes (las que tú escribes desde la app son gratis).
  **Debe haber un medio de pago en la cuenta de Meta.**
- IA: con el modelo local, $0; con Claude, unos $4.000–5.000 COP en un mes normal (máximo configurado: US$10/mes).
- Te llega un resumen cada noche con el costo del día.
