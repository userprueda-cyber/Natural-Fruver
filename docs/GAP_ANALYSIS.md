# Gap analysis: existing bot vs. master prompt

Written 2026-09-28. Baseline: the working tree on `claude/fervent-albattani-52ngc5`, 46/46 tests passing.
Legend: ✅ have · 🟡 partial · ❌ missing. Effort: S (< ½ day), M (1–2 days), L (3+ days).

## Bugs found while reading (fix first, Phase 1)

1. **Double order on double tap or concurrent retry (§2.1, rows 2/45). Real bug.**
   - What happens: `Bot.gs` `confirmOrder_` checks `c.row.paso === 'confirmar'` *outside* any lock. Two executions (a double tap on ✅ Confirmar, or a Meta retry that slips past the CacheService dedupe) both see `confirmar` and both call `Orders.gs` `createOrder_`.
   - Why the lock doesn't help: `createOrder_` holds the script lock, which only serializes the two calls. It doesn't deduplicate them, so both write an order and decrement stock twice.
   - Fix: an idempotency key (phone + cart version) checked and stored under the same lock, plus reading and resetting `paso` inside the lock.
2. **Inbound messages can be lost (rows 5, 9, 13).**
   - What happens: `relay/worker.js` returns 200 and then forwards with `ctx.waitUntil(forward(...))`. If Apps Script errors, times out or hits quota, `forward` only `console.error`s.
   - Why it's lost: Meta already got its 200, so it won't retry.
3. **Status webhooks are dropped.** `hasMessages()` filters out anything without `messages`, so a `failed` delivery on an order confirmation or a worker alert is invisible (§4, row 47).
4. **Worker order alert isn't retried.** `notifyWorkersNewOrder_` sends once per worker. On any non-131047 failure, or if no template is configured, nobody knows about the order (row 47).
5. **Quantities are capped silently.** `priceItems_` clamps any quantity > `MAX_QTY` (50) to 50 without telling the customer. That violates "never guess silently" (row 24).
6. **Meta calls run inside the script lock.** `createOrder_` and `setOrderStatus_` call `syncCatalogQuietly_` (UrlFetch to Meta) while holding the lock, so a slow Meta call blocks every other order (`waitLock(20000)` then throws).
7. **The dedupe cache is lossy.** `alreadySeen_` uses `CacheService` (6 h TTL, best-effort, can be evicted). There's no durable `wamid` record.

## By section

| § | Topic | Status | Where / what's missing | Effort |
|---|---|---|---|---|
| 1 | Scope limits (no general assistant) | 🟡 | The bot only does shop things (no LLM), but there's no polite off-topic redirect | S |
| 2 | Principles | 🟡 | Money is computed in code ✅ (`priceItems_` ignores cart prices). Missing: human escape, fail-soft menu mode, spend caps, disclosure | — |
| 3 | Architecture: durable queue, per-customer ordering, debounce | ❌ | Relay is fire-and-forget. No queue, no per-customer lock, no burst merge. See DECISIONS.md D2 | L |
| 3 | Official Cloud API, no unofficial libs | ✅ | `WhatsApp.gs` | — |
| 4 | 24 h window tracking | 🟡 | Only reactive (131047 → template for workers). There's no `last_inbound_at` per customer, and customers never get a template fallback | M |
| 4 | Templates | 🟡 | Worker `aviso_pedido` only. Needs utility templates for order confirmation/status outside the window | S (+ Meta approval time) |
| 4 | Opt-out (BAJA/STOP) | ❌ | | S |
| 4 | Read receipts / typing | 🟡 | `waMarkRead_` exists but isn't called | S |
| 4 | Status webhooks | ❌ | Dropped in relay (bug 3) | M |
| 4 | Token health check | ❌ | | S |
| 4 | Message-limit constants + test | 🟡 | Constants in `WhatsApp.gs` and truncation via `cut_`. Missing: a test asserting that no outgoing message violates them | S |
| 5.1 | Goal-oriented first message + **automation disclosure** + "asesor" | 🟡 | `sendMenu_` is goal-oriented with 3 buttons ✅. It doesn't say it's automated or offer a human ❌ | S |
| 5.1 | Returning customer "¿repetimos tu último pedido?" | ❌ | Name greeting ✅ | M |
| 5.2 | Free text first | 🟡 | Free text = product search only (`findProducts_`). It can't read "2 lb de tomate y 1 kg papa" | L (Phase 2–3) |
| 5.3 | Tone: "usted" by default, mirror the customer | ❌ | Bot uses "tú" everywhere. **Owner decision** | S |
| 5.4 | Ask the minimum; saved address/name | ✅ | `direccion?` reuse, name saved in `Clientes` | — |
| 5.4 | Warn about and redact cédula/card/OTP | ❌ | | S |
| 5.5 | Debounce bursts, per-customer order | ❌ | | M (DO alarm) |
| 5.6 | Every reply has a next step | 🟡 | Mostly buttons. Some plain texts (e.g., status notices) end without a CTA | S |
| 5.7 | State machine | 🟡 | `Clientes.paso`: `'' → entrega → direccion(?) → nombre → nota/confirmar`. No payment step, no HANDOFF/EXPIRED states, and cart editing only works by resending the WhatsApp cart | M |
| 5.7 | Cart summary + weight caveat | 🟡 | `sendSummary_` itemized ✅. The "aprox./peso final" caveat is missing | S |
| 5.7 | Exactly-once order creation | ❌ | **Bug 1** | M |
| 5.7 | Post-order: ETA, how to change/cancel | 🟡 | Order no. ✅. No ETA and no cancel instructions. Customers can't cancel a placed order | S |
| 5.7 | Abandoned-cart reminder (max 1, in-window) | ❌ | 12 h session reset only | S |
| 5.8 | Human handoff (triggers, silence, owner alert, escalation, idle resume) | ❌ | Nothing. `smb_message_echoes` can detect owner replies (PLATFORM_FACTS) | L |
| 5.9 | Personality ("¿eres un robot?") | ❌ | | S |
| 5.10 | Max one upsell | ✅ (none) | | — |
| 6 L0 | Guards: length, emoji-only, spam, rate limit, bot loop | 🟡 | `clip_` lengths only | M |
| 6 L1 | Normalization: abbreviations, fractions, units in config | 🟡 | `normalize_` = lowercase + strip accents. Units are hardcoded `UNIT_LABELS`, `DECIMAL_UNITS` | M |
| 6 L2 | Intents, fuzzy matching with confidence, qty+unit extraction, affirm/deny | ❌ | `findProducts_` is exact/prefix word match, no typo tolerance and no confidence | L |
| 6 L3 | LLM structured understanding | ❌ | | L |
| 6 L4 | Voice notes | ❌ | Falls to `kind:'other'` → menu | M |
| 6 L5 | Images → handoff; payment proofs never auto-verified | ❌ | Falls to menu | S |
| 6 | 300-message NLU eval set | ❌ | | M |
| 7 | Cost control: ledger, budgets, circuit breaker, reports | ❌ | Not needed until an LLM is added. Must ship with Phase 3 | M |
| 8 | Webhook signature (raw body, constant time) | ✅ | `relay/worker.js` `validSignature` | — |
| 8 | Only our `phone_number_id` | ❌ | The relay forwards any entry | S |
| 8 | Old-event age check | ❌ | | S |
| 8 | Secrets out of git/logs | 🟡 | Script Properties + wrangler secrets ✅. `RELAY_SECRET` travels in the JSON body (fine over TLS, but it lands in any body logging). No gitleaks | S |
| 8 | Admin surface | 🟡 | PIN page. **Global** lockout lets anyone lock workers out for 10 min (known) | M |
| 8 | Data isolation per customer | ✅ | `sendMyOrders_` filters by the sender's phone. Needs an explicit test | S |
| 8 | Log redaction | ❌ | `console.*` with phone numbers in places | S |
| 8 | Kill switch `/pausar` `/reanudar` | ❌ | | S |
| 8 | Backups | 🟡 | Google Sheets version history. Not a tested restore procedure | S |
| 9 | Ley 1581 consent, view/delete data, retention | ❌ | `Clientes` keeps name, address and raw state forever | M |
| 10 | Error matrix | see below | | |
| 11 | Owner alerts, commands, catalog management | 🟡 | Strong base: `pedidos`, `pedido N`, `confirmar/entregado/cancelar N`, `precio`, `oferta`, `stock`, `agotado/disponible`, `ver` + admin page + Sheet. Missing: `/pausar`, `/reanudar`, `/tomar`, `/devolver`, `/hoy`, `/ayuda`, an "en camino" state, undo, alert retry until ack, daily summary on WhatsApp (email exists), weekly "unanswered questions" | M |
| 11 | Owner manual (Spanish) | 🟡 | `GUIA.md`, `WHATSAPP.md` are setup guides, not a day-to-day manual | S |
| 12 | Observability: structured logs, metrics, `/health`, alerts, runbook | ❌ | `?action=ping` only | M |
| 13 | Tests | 🟡 | 46 tests incl. whole conversations through `gas-mock.js` ✅. No adversarial, chaos, load or cost tests | M–L |
| 14 | Shadow/assisted rollout | ❌ | | M |

## Error matrix (§10)

| # | Situation | Status | Notes |
|---|---|---|---|
| 1 | Bad or missing signature | ✅ | 401 (prompt says 403; either is fine). No alert on repeated failures |
| 2 | Duplicate webhook | 🟡 | CacheService dedupe, lossy. Bug 1 |
| 3 | Out-of-order messages | ❌ | |
| 4 | Server slow > 3 s | ✅ | Relay acks immediately. No p95 alert |
| 5 | Down / restart | ❌ | Bug 2 |
| 6 | LLM error/timeout | n/a | no LLM yet |
| 7 | LLM invalid JSON | n/a | |
| 8 | LLM budget exhausted | n/a | |
| 9 | WA send fails | ❌ | `graph_` logs a warning, no retry, no alert |
| 10 | Outside 24 h window | 🟡 | Workers only |
| 11 | Meta rate limit | ❌ | |
| 12 | Token expired | ❌ | |
| 13 | DB (Sheet) down / slow | 🟡 | Generic "algo falló" reply. Nothing is queued |
| 14 | Audio | ❌ | |
| 15 | Image/video/doc/sticker/contact/location | 🟡 | Location ✅ at the address step. Everything else → menu |
| 16 | Edited/deleted message | ❌ | |
| 17 | Empty/emoji/gibberish | 🟡 | Menu (not "no entiendo") ✅. No 👍-as-affirm |
| 18 | Very long message | 🟡 | Clipped. No "please summarize" |
| 19 | Topic switch mid-order | 🟡 | "horario" mid-flow shows info. Cart kept in `datos` ✅. No "¿seguimos?" |
| 20 | Change/cancel after confirming | ❌ | Customer can't. Worker can |
| 21 | Product not found | 🟡 | "No encontré" + buttons. No closest-3 suggestions |
| 22 | Out of stock | ✅ | `priceItems_` problems shown. No substitute offer |
| 23 | Ambiguous product | ❌ | Worker side asks. Customer side returns all matches |
| 24 | Absurd quantity | ❌ | Bug 5 |
| 25 | Variable-weight items | 🟡 | kg in whole units (cart limitation). No "aprox." |
| 26 | Unclear address | 🟡 | Length ≥ 5 + location. No missing-piece prompts |
| 27 | Outside delivery zone | ❌ | Zones are free text only |
| 28 | Below minimum | ✅ | `sendSummary_` and `createOrder_` |
| 29 | Shop closed / holiday | 🟡 | Hours ✅ and "lo preparamos cuando abramos". **No Colombian festivos** |
| 30 | "Ya pagué" / proof | ❌ | No payment step at all |
| 31 | Discount haggling | ❌ | |
| 32 | Prompt injection | n/a now | Required with Phase 3 |
| 33 | Off-topic | ❌ | Treated as product search → "No encontré" |
| 34 | Abuse | ❌ | |
| 35 | Angry / complaint | ❌ | |
| 36 | "asesor" after hours | ❌ | |
| 37 | Owner replies manually | ❌ | Use `smb_message_echoes` |
| 38 | Owner doesn't respond | ❌ | |
| 39 | Same name/address | ✅ | Identity = phone (`samePhone_`, last 10 digits) |
| 40 | Number changed | 🟡 | Saved address re-confirmed with buttons ✅ |
| 41 | English/other language | ❌ | |
| 42 | Bot loop | ❌ | |
| 43 | Timezone | ✅ | `appsscript.json` tz + `tz_()`. Needs midnight/festivo tests |
| 44 | Catalog changed while cart open | ✅ | Re-priced at summary and inside the lock at confirm. Price *changes* aren't called out explicitly |
| 45 | Concurrent messages same customer | ❌ | Bug 1 |
| 46 | Integer COP / rounding | 🟡 | `Math.round(price*qty)` per line, one place. Needs a written rule + tests |
| 47 | Owner notification fails | ❌ | Bug 4 |
| 48 | Owner marks status wrongly | ❌ | Final states are immutable, with no undo |
| 49 | Data deletion request | ❌ | |
| 50 | Resource pressure / crash | 🟡 | Managed platforms (Apps Script, Workers). No health alerts |

**Score:** 7 ✅ / 14 🟡 / 25 ❌ / 4 n/a (rows 6, 7, 8, 32 need the LLM layer).

## Other
- `repo/` is an older partial copy of the project (no `Bot.gs`, `WhatsApp.gs` or relay). **Ask before deleting.**
- Placeholder facts that are **customer-visible right now**:
  - seed prices;
  - `domicilio_valor = 4000`, `domicilio_gratis_desde = 60000`;
  - `zonas_domicilio` text.

  None are flagged as unconfirmed. See OWNER_QUESTIONS.md.
