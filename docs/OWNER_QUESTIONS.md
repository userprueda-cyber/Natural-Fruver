# Preguntas para el dueño de Natural Fruver

Lo que ya sabemos viene de `apps-script/Setup.gs` y del catálogo de Instagram (julio–septiembre 2026).
Marcas: ✅ **confirmar** (ya tenemos un dato, solo hay que confirmarlo) · 🟡 **provisional** (hay un valor de ejemplo que se ve hoy) · ❌ **falta** (no lo sabemos).

**Regla del bot:** si un dato está en ❌ o 🟡, el bot **no lo promete**. Dice "un asesor le confirma".

## 🚨 Urgente (antes del 30 de septiembre de 2026)
1. ¿La cuenta de **Meta Business / WhatsApp Manager** ya tiene un **método de pago**? Varias fuentes dicen que desde el 1 de octubre las respuestas por la API se cobran después de 1.000 mensajes al mes, y que sin método de pago Meta puede dejar de entregarlas. ❌
2. ¿El número 313 596 2382 ya está conectado a la API de WhatsApp (coexistencia), o todavía no? ¿Quién lo conectó y con qué proveedor? ❌

## Negocio
| # | Pregunta | Lo que tenemos | Estado |
|---|---|---|---|
| 3 | Número que usan los clientes | 57 313 596 2382 | ✅ confirmar |
| 4 | Número del dueño para alertas, y **número de respaldo** si no contesta | — | ❌ |
| 5 | Dirección y pin de ubicación | Kioskos de Promalabar, Malabar – Cerritos, Pereira | ✅ confirmar (+ pin de Google Maps) |
| 6 | Horario | lun–vie 8:30–18:00; sáb–dom 8:30–16:00 | ✅ confirmar |
| 7 | ¿Abren los **festivos**? ¿Con qué horario? | — | ❌ |
| 8 | ¿Se puede recoger en tienda? | El bot ya lo ofrece | ✅ confirmar |
| 9 | Domicilios: ¿qué barrios o zonas? ¿Dosquebradas, Cerritos, Condina…? | "Pereira. Programa tu domicilio con 1 día de antelación" | 🟡 |
| 10 | Valor del domicilio (¿fijo o por zona?) y ¿gratis desde cuánto? | $4.000; gratis desde $60.000 | 🟡 |
| 11 | Pedido mínimo | $0 | 🟡 |
| 12 | ¿Hasta qué hora se recibe un pedido para entregarlo el mismo día? ¿O siempre es al día siguiente? | "1 día de antelación" | 🟡 |
| 13 | ¿Quién hace los domicilios? ¿Se da una hora aproximada al cliente? | — | ❌ |
| 14 | **Formas de pago** (efectivo contraentrega, Nequi, Daviplata, transferencia, datáfono) | — | ❌ |
| 15 | ¿Se paga antes o al recibir? Datos de la cuenta (el bot los muestra solo al final) | — | ❌ |
| 16 | **Precios reales** de los 123 productos. ¿Cada cuánto cambian? ¿Quién los actualiza? | Precios de referencia inventados | 🟡 **el bot hoy los muestra** |
| 17 | Productos por peso: ¿cómo se cobra la diferencia cuando el peso real cambia? | — | ❌ |
| 18 | Si algo se agota: ¿se reemplaza por algo parecido, se quita o se llama al cliente? | Hoy se quita y se avisa | 🟡 |
| 19 | ¿Hasta cuándo puede el cliente cambiar o cancelar un pedido? | — | ❌ |
| 20 | Quejas (llegó dañado, faltó algo, cobro de más): ¿cómo las quiere manejar? ¿Hay devoluciones? | — | ❌ |
| 21 | ¿Hay clientes grandes (restaurantes, mayoristas)? ¿Desde qué valor un pedido es "grande" y lo revisa una persona? | — | ❌ |
| 22 | ¿"Usted" o "tú" con los clientes? ¿Frases o emojis de la marca? | El bot hoy dice "tú" | ❌ |
| 23 | ¿Cuántos mensajes y pedidos llegan al día? ¿A qué horas hay más movimiento? | Supuesto: 60 mensajes y 10 pedidos | ❌ |
| 24 | ¿Cuánto está dispuesto a pagar al mes por todo (WhatsApp + IA + servidor)? | Estimado: ~$54.000 COP/mes | ❌ |
| 25 | ¿Quiere que el bot entienda **audios de voz**? Cuesta un poco más. | Apagado por ahora | ❌ |
| 26 | ¿La cuenta de Meta Business está **verificada** (RUT / Cámara de Comercio)? | — | ❌ |
| 27 | Datos personales (Ley 1581): ¿quién es el responsable y cuál es su correo o teléfono para solicitudes? | — | ❌ |
| 28 | ¿Qué hacer con la carpeta `repo/` del proyecto (copia vieja)? *(pregunta para el desarrollador)* | — | ❌ |

## Lista de datos "TODO" que el bot no puede prometer hasta tenerlos
`festivos`, `zonas_domicilio` (lista real), `domicilio_valor`, `domicilio_gratis_desde`, `pedido_minimo`, `hora_corte_mismo_dia`, `metodos_pago`, `datos_pago`, `politica_peso`, `politica_sustitucion`, `politica_cancelacion`, `politica_quejas`, `pedido_grande_desde`, `numero_respaldo`, `contacto_datos_personales`, `tono`, precios de todos los productos.
