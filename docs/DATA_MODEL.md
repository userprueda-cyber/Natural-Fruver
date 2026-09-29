# Data model

Two stores, split along D2/D3 (DECISIONS.md):
- **Google Sheet:** the owner-facing system of record for the catalog, orders, config and workers. The owner can read and edit it.
- **Cloudflare D1 + Durable Objects:** machine state for the inbox, conversations, ledger, audit and handoffs. The owner never edits it; the daily summary and `/hoy` expose it.

Identity is **the WhatsApp number only** (E.164 digits, e.g. `573001234567`). Compare with `samePhone_` (last 10 digits).

## Sheet: current tabs (Util.gs)
| Tab | Columns | Notes |
|---|---|---|
| `Productos` | id, nombre, categoria, precio, unidad, precio_oferta, oferta_hasta, stock, disponible, destacado, foto_url, descripcion, palabras_clave, orden, archivado, actualizado, actualizado_por, en_whatsapp | 123 products. `palabras_clave` doubles as the alias list for matching |
| `Categorias` | nombre, icono, orden | |
| `Pedidos` | nro, fecha, estado, cliente, telefono, entrega, direccion, notas, items(JSON), subtotal, domicilio, total, actualizado, actualizado_por | `estado` ∈ pendiente, confirmado, entregado, cancelado |
| `Config` | clave, valor, nota | See Setup.gs `DEFAULT_CONFIG` |
| `Trabajadores` | nombre, pin, activo, whatsapp | Allowlist for worker commands |
| `Clientes` | telefono, nombre, direccion, paso, datos(JSON), actualizado | Conversation state lives here today and moves to the DO (see below) |

## Sheet: proposed changes
| Tab | Change | Why |
|---|---|---|
| `Pedidos` | + `clave_idempotencia` (unique), `pago` (método), `pago_verificado` (sí/no/quién), `wamid_origen`, `aviso_trabajadores` (pendiente/enviado/fallido/visto) | Prevent double orders (bug 1), payment step, alert acknowledgement (row 47) |
| `Pedidos.estado` | + `en_preparacion`, `en_camino` | §1 status updates |
| `Productos` | + `alias` (separate from keywords), `peso_variable` (sí/no), `max_cantidad` | NLU matching, weight caveat, absurd-quantity threshold |
| `Config` | + `metodos_pago`, `datos_pago` (shown only at the payment step), `politica_peso`, `politica_sustitucion`, `politica_cancelacion`, `festivos` (or computed), `tono` (usted/tu), `pedido_grande_desde`, `contacto_datos_personales`, `numero_respaldo`, `bot_pausado`, `minutos_escalar_asesor` | Business facts the bot may state. **Empty = bot refuses to promise** |
| new `Unidades` | unidad, sinónimos, gramos, decimales | §6 "unit table lives in config" |
| `Clientes` | drop `paso`/`datos` once the DO owns state; + `consentimiento_version`, `consentimiento_fecha`, `optout`, `bloqueado`, `marca_no_show` | Ley 1581, opt-out, abuse |

## D1 tables (proposed)
```sql
inbox(            -- every inbound message, deduplicated
  wamid TEXT PRIMARY KEY, phone_hash TEXT, phone_enc TEXT, received_at INTEGER, msg_ts INTEGER,
  type TEXT, body_redacted TEXT, raw_json TEXT, status TEXT CHECK(status IN ('new','processing','done','failed','skipped')),
  attempts INTEGER DEFAULT 0, last_error TEXT)
status_events(    -- delivery statuses for outgoing messages
  status_id TEXT PRIMARY KEY, out_wamid TEXT, status TEXT, error_code INTEGER, ts INTEGER)
outbox(           -- outgoing messages with retry
  id TEXT PRIMARY KEY, phone_hash TEXT, kind TEXT, payload_json TEXT, purpose TEXT, -- 'reply','order_alert','status'
  out_wamid TEXT, state TEXT, attempts INTEGER, next_try_at INTEGER, created_at INTEGER)
usage_ledger(     -- every paid call
  id INTEGER PRIMARY KEY, ts INTEGER, day TEXT, phone_hash TEXT, feature TEXT, -- 'nlu','stt','wa_send'
  model TEXT, input_tokens INTEGER, cached_tokens INTEGER, output_tokens INTEGER, cost_usd_micros INTEGER)
audit(            -- decisions and admin actions, redacted
  id INTEGER PRIMARY KEY, ts INTEGER, actor TEXT, phone_hash TEXT, action TEXT, detail_json TEXT, correlation_id TEXT)
handoffs(
  id INTEGER PRIMARY KEY, phone_hash TEXT, reason TEXT, opened_at INTEGER, taken_by TEXT, closed_at INTEGER,
  last_customer_msg_at INTEGER, last_owner_msg_at INTEGER, escalated_at INTEGER)
consents(phone_hash TEXT, version TEXT, ts INTEGER, PRIMARY KEY(phone_hash, version))
optouts(phone_hash TEXT PRIMARY KEY, ts INTEGER)
blocklist(phone_hash TEXT PRIMARY KEY, reason TEXT, ts INTEGER, until INTEGER)
```
`phone_hash` = HMAC-SHA256(phone, `PHONE_PEPPER`). It's used for joins and logs. `phone_enc` (AES-GCM) is stored only where the bot must reply later.

## Durable Object state (one per phone)
`{ step, cart:{version, items:[{product_id, qty, unit}]}, delivery, address, payment, notes, pending_burst:[wamid…], debounce_until, last_inbound_at (24 h window), handoff:{active, since, by}, misunderstandings, llm_calls_hour/day, lang, tone }`.
The state object is the conversation memory (§7a). Transcripts are never sent in full to the LLM.

## Retention (proposed; owner and lawyer confirm)
| Data | Keep |
|---|---|
| Orders (`Pedidos`) | As long as needed for accounting (Colombia commonly uses 10 years for commercial books; confirm) |
| `inbox.raw_json` / `body_redacted` | 90 days, then purge |
| Audio | Deleted right after transcription. Never stored |
| Images | Not stored. The media ID is forwarded to the owner, then discarded |
| `usage_ledger`, `audit` | 13 months |
| Customer profile (name, address) | Until a deletion request, or 24 months of inactivity |
| Deletion request | Anonymize the `Clientes` row and DO state, and keep orders with the name and address replaced by `[eliminado]` |
