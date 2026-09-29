# Conversation and system flows

## 1. Message pipeline (proposed, D2/D3)
```mermaid
flowchart TD
  M[Meta webhook POST] --> S{Signature and phone_number_id OK?}
  S -- no --> R403[401/403 + count; alert on spike]
  S -- yes --> I[(D1 inbox: INSERT wamid, unique)]
  I -- duplicate --> OK200[200]
  I -- new --> ACK[200 in < 1 s] --> DO[Customer Durable Object]
  I -- status event --> SE[(status_events)] --> F{failed on order alert/confirmation?} -- yes --> AL[Alert owner via backup path]
  I -- smb_message_echoes --> HO[Mark chat as handled by human]
  DO --> DB[Debounce ~5 s via alarm, merge burst]
  DB --> P{Paused, opted out, blocked, or handoff active?}
  P -- yes --> SIL[Stay silent / log]
  P -- no --> L0[L0 guards: length, rate, emoji, spam, loop, media type]
  L0 --> L1[L1 normalize: abbreviations, numbers, fractions, units]
  L1 --> L2[L2 deterministic: intents, product fuzzy match, qty+unit, affirm/deny]
  L2 -- confident --> SM[State machine]
  L2 -- low confidence --> B{Budget and per-phone caps OK?}
  B -- no --> MENU[Menu mode: buttons/lists, zero tokens]
  B -- yes --> L3[LLM structured output] --> V{Validate schema, ids, bounds}
  V -- ok --> SM
  V -- invalid --> RETRY[1 retry with error] -- still bad --> CLAR[Clarifying question or handoff]
  SM --> OUT[(outbox)] --> SEND[Graph API send with retry/backoff] --> LED[(usage_ledger + audit)]
```

## 2. Customer order state machine (§5.7)
```mermaid
stateDiagram-v2
  [*] --> GREETING
  GREETING --> BUILDING_CART: product text / catalog cart / "hacer pedido"
  BUILDING_CART --> BUILDING_CART: add / remove / change qty
  BUILDING_CART --> DELIVERY_OR_PICKUP: "listo" / cart sent
  DELIVERY_OR_PICKUP --> ADDRESS: domicilio
  DELIVERY_OR_PICKUP --> PAYMENT: recoger
  ADDRESS --> ADDRESS: missing piece / out of zone → offer pickup
  ADDRESS --> PAYMENT
  PAYMENT --> REVIEW
  REVIEW --> BUILDING_CART: "cambiar algo"
  REVIEW --> PLACED: explicit Confirmar (idempotency key = phone + cart.version)
  PLACED --> STATUS_UPDATES: owner sets en_preparacion / en_camino
  STATUS_UPDATES --> DONE: entregado
  PLACED --> CANCELLED: customer before cutoff, or owner
  BUILDING_CART --> EXPIRED: idle > session hours (one in-window reminder max)
  REVIEW --> EXPIRED
  state "HUMAN_HANDOFF (reachable from any state)" as HUMAN_HANDOFF
  BUILDING_CART --> HUMAN_HANDOFF
  REVIEW --> HUMAN_HANDOFF
  PLACED --> HUMAN_HANDOFF
  HUMAN_HANDOFF --> BUILDING_CART: /devolver or idle timeout (cart preserved)
  CANCELLED --> [*]
  DONE --> [*]
  EXPIRED --> [*]
```
Today's `Clientes.paso` maps onto this as: `''` = GREETING/BUILDING_CART, `entrega` = DELIVERY_OR_PICKUP, `direccion`/`direccion?` = ADDRESS, `nombre` = (name capture), `nota`/`confirmar` = REVIEW. PAYMENT, HANDOFF and EXPIRED don't exist yet.

## 3. Human handoff and escalation (§5.8)
```mermaid
sequenceDiagram
  participant C as Customer
  participant B as Bot (DO)
  participant O as Owner / workers
  participant K as Backup number
  C->>B: "asesor" / complaint / 2 misunderstandings / payment proof / big order
  B->>C: "Ya le aviso a un asesor… quedo atento." (after hours: realistic time)
  B->>O: Alert: name, number, reason, last messages, cart, "/tomar 3xx"
  Note over B: handoff.active = true → bot silent for this chat
  alt Owner replies (app echo or /tomar)
    O->>C: manual messages (smb_message_echoes)
    O->>B: /devolver 3xx (or idle timeout)
    B->>C: "Sigo por aquí si necesita algo más 😊"
  else No owner reply in N min
    B->>K: Escalation alert
    B->>C: "Sigue en cola, ya casi le atienden" (max 1 per 10 min)
  end
```

## 4. Budget circuit breaker (§7)
```mermaid
stateDiagram-v2
  [*] --> NORMAL
  NORMAL --> WARN50: month spend ≥ 50% → alert owner + dev
  WARN50 --> WARN80: ≥ 80% → alert
  WARN80 --> MENU_MODE: ≥ 100% month OR daily cap hit
  NORMAL --> MENU_MODE: LLM provider down (2 failed retries), circuit open 5 min
  MENU_MODE --> NORMAL: new day/month, or budget raised, or provider healthy (half-open probe)
  note right of MENU_MODE: Deterministic layers + buttons + lists + handoff. Zero tokens. Bot keeps taking orders.
```
