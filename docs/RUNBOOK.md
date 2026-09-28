# Runbook: qué hacer cuando algo falla

Para el desarrollador y para quien ayude al dueño. Cada caso dice primero **cómo se nota**, luego **qué hacer**.
Lo más importante: **el botón de pánico siempre funciona**. Un trabajador escribe **pausar** al WhatsApp de la tienda
(o en la hoja: menú *Natural Fruver → Pausar el bot*), y todos los chats quedan para personas.

| Palanca | Dónde | Efecto |
|---|---|---|
| `pausar` / `reanudar` | WhatsApp (trabajador) o menú de la hoja | El bot deja de responder a clientes (les dice una vez que los atiende una persona) |
| `BOT_PAUSED = si` | Apps Script → Propiedades del script | Igual, para el desarrollador (no depende de la hoja) |
| `ia_activa = no` | Hoja → Config | El bot sigue funcionando solo con reglas y botones, costo IA = 0 |
| `modo_bot = sombra` | Hoja → Config | Cada respuesta la aprueba un trabajador antes de salir |
| `bloquear 300…` | WhatsApp (trabajador) | Ese número deja de recibir respuestas |

Salud en un vistazo: `https://<relé>.workers.dev/health` (o `…/exec?action=salud&clave=<HEALTH_KEY>`). Pon esa URL en
un monitor gratis (UptimeRobot, cada 5 min) con alerta al correo del desarrollador.

---

## Token de WhatsApp vencido o revocado
**Se nota:** el bot no contesta; `health` dice `whatsapp: error 401` o `190`; llega el correo "WhatsApp no acepta el token" (revisión diaria de las 7 a. m.).
**Qué hacer:**
1. business.facebook.com/settings → *Usuarios del sistema* → "bot" → *Generar token* (app, vencimiento **Nunca**, permisos `whatsapp_business_messaging`, `whatsapp_business_management`, `catalog_management`).
2. Apps Script → Configuración → Propiedades del script → reemplaza `WA_TOKEN`.
3. No hay que volver a implementar: las propiedades se leen en cada mensaje. Prueba escribiendo *hola* desde otro celular.
4. Si el token se revocó sin que nadie lo cambiara, revisa quién tiene acceso al Business Manager (posible incidente de seguridad, ver abajo).

## Meta caído o lento
**Se nota:** `health` muestra errores 5xx; Meta Status (metastatus.com) reporta problemas.
**Qué hacer:** nada urgente. El bot reintenta los envíos 2 veces, los avisos de pedidos se reintentan cada 5 minutos,
y Meta reintenta los webhooks durante horas. Con la **cola** del relé activada, ningún mensaje se pierde. Avisa al
dueño que conteste desde la app si algo es urgente.

## IA caída (Ollama o Anthropic)
**Se nota:** en `health` → `ia: fallas`; más "no entendidos" en el resumen.
**Qué hacer:** nada para que el bot siga: tras 2 fallas seguidas deja de llamar a la IA 5 minutos y atiende con reglas y botones.
- Ollama: revisa que el computador esté prendido, `ollama serve` corriendo y el túnel activo (`cloudflared tunnel list`).
- Anthropic: status.anthropic.com. Si tarda, pon `ia_activa = no`.

## Presupuesto de IA agotado
**Se nota:** mensaje a los trabajadores "La IA del bot lleva 100% del presupuesto". El bot sigue sin IA.
**Qué hacer:** decide con el dueño si sube `ia_presupuesto_mes_usd` (hoja → Config). Revisa la pestaña **Uso**: si un solo
número gasta mucho, bloquéalo (`bloquear 300…`). El límite **del proveedor** (consola de Anthropic → Limits) es el respaldo
si el código fallara: déjalo siempre en ~US$15/mes.

## Hoja de Google con problemas / borraron algo
**Se nota:** clientes reciben "estamos con un inconveniente" y llega el aviso del error.
**Qué hacer:**
1. Hoja → *Archivo → Historial de versiones* → restaura la versión anterior al cambio (o copia solo la pestaña dañada).
2. Si alguien borró columnas: menú *Natural Fruver → Configurar hojas* las vuelve a crear (no borra datos).
3. Copia de seguridad semanal: *Archivo → Descargar → Excel* y guárdalo en Drive (RPO: 1 semana; con el historial de versiones, minutos). RTO: 15 minutos.

## Apps Script falla o se excedió la cuota
**Se nota:** `health` del relé → `apps_script: error`; en *Apps Script → Ejecuciones* aparecen fallas.
**Qué hacer:** abre la ejecución fallida y lee el error. Cuotas: ~20.000 llamadas UrlFetch/día y 6 min por ejecución (sobra
para una tienda). Si fue un cambio de código, vuelve a la versión anterior: *Implementar → Gestionar implementaciones →
editar → Versión anterior*.

## Número marcado, calidad baja o bloqueado por Meta
**Se nota:** `health` → `calidad: YELLOW/RED`; aviso en WhatsApp Manager.
**Qué hacer:** pon `modo_bot = sombra` unos días; revisa *SinResolver* y *Registro* por respuestas raras; nunca envíes
mensajes que el cliente no pidió. Si Meta restringe el número, sigue las instrucciones de WhatsApp Manager y avisa al dueño.

## Revertir un despliegue
- Apps Script: *Implementar → Gestionar implementaciones → editar → elegir la versión anterior* (misma URL).
- Relé: `cd relay && npx wrangler rollback`.
- Código: `git revert <commit>` y vuelve a copiar/`clasp push`.

## Rotar secretos
| Secreto | Dónde vive | Cómo rotarlo |
|---|---|---|
| `WA_TOKEN` | Propiedades del script | Ver "Token vencido" |
| `APP_SECRET` | Relé (`wrangler secret`) | developers.facebook.com → app → Configuración básica → *Restablecer* → `npx wrangler secret put APP_SECRET` |
| `RELAY_SECRET` | Propiedades del script **y** relé | Genera uno nuevo, ponlo primero en el relé y luego en Apps Script (unos segundos de mensajes rechazados; Meta los reintenta) |
| `VERIFY_TOKEN` | Relé | Cambia en el relé y en Meta → Webhook → Editar |
| `ANTHROPIC_API_KEY` | Propiedades del script | console.anthropic.com → API keys → crear nueva, borrar la vieja |
| `OLLAMA_ACCESS_ID/SECRET` | Propiedades del script | Cloudflare Zero Trust → Access → Service tokens |
| PIN de trabajadores | Pestaña Trabajadores | Cambiar el PIN en la hoja |

## Incidente de seguridad (fuga de datos, token robado)
1. `pausar` el bot. 2. Rota **todos** los secretos de la tabla. 3. Revisa *Registro* y el historial de la hoja.
4. Ley 1581: si se filtraron datos personales, el responsable debe informar a la SIC y a los afectados (confírmalo con un abogado).
5. Escribe qué pasó en `DECISIONS.md` y agrega una prueba que lo evite.

## Usar Ollama (modelo local) en producción
Apps Script corre en los servidores de Google: **no ve `localhost`**. Para usar el modelo de tu computador:
1. `brew install cloudflared` → `cloudflared tunnel login` → `cloudflared tunnel create fruver-ia`.
2. Configura el túnel para `http://localhost:11434` en un subdominio (ej. `ia.tudominio.com`) y `cloudflared tunnel run fruver-ia`.
3. Cloudflare Zero Trust → Access → Application para ese subdominio con política **Service Auth**, y crea un *Service token*.
4. En Propiedades del script: `OLLAMA_ACCESS_ID`, `OLLAMA_ACCESS_SECRET`; en Config: `ia_url = https://ia.tudominio.com`.
**Riesgos:** si el computador se apaga o se duerme, la IA cae (el bot sigue con reglas). Cada respuesta tarda 5–30 s.
Recomendación: Ollama para pruebas; Claude Haiku (unos US$0,50/mes en el escenario esperado) para producción.

## Probar en Telegram (sin tocar WhatsApp)
```bash
TELEGRAM_TOKEN=123:abc npm run telegram
```
Usa el mismo código de `apps-script/`, la hoja simulada y, si está corriendo, Ollama. Comandos: `/trabajador`, `/reiniciar`,
`/tareas`, `/modo sombra|asistido|autonomo`, `/ia on|off`. Notas de voz: `DEEPGRAM_API_KEY=… npm run telegram`.
