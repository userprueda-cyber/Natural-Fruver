# Natural Fruver — WhatsApp ordering bot

Customers of **Natural Fruver Pereira** order entirely inside WhatsApp: they browse the store's WhatsApp catalog (photos, prices), send a cart, choose delivery or pickup, and confirm. Workers manage orders, prices, offers and stock by messaging the same bot (or from the Sheet / worker page). Customers can also just write what they want ("2 lbs d tomate y 3 aguacates xfa"). It runs on Google Sheets + Apps Script + a Cloudflare Worker and the WhatsApp Cloud API. From 1 Oct 2026, Meta charges bot replies beyond 1,000/month, so a payment method must be on the Meta account (see [docs/PLATFORM_FACTS.md](docs/PLATFORM_FACTS.md)). AI is optional: a local Ollama model or Claude Haiku, capped by budget.

> 🇨🇴 Setup guides for the store are in Spanish: **[docs/GUIA.md](docs/GUIA.md)** (Sheet, Apps Script, worker page) and **[docs/WHATSAPP.md](docs/WHATSAPP.md)** (Meta, catalog, relay, worker commands).

```
 Customers ─► WhatsApp ─► Meta ─webhook─► relay/worker.js ──────► Apps Script web app ◄──► Google Sheet
 Workers   ─┘  (same number, coexists       (Cloudflare: checks     (Bot.gs: chat flow,      Productos · Pedidos ·
               with the Business app)        signature, answers 200)  Orders.gs: stock lock)   Clientes · Config ·
                         ▲                                                  │                   Trabajadores
                         └── replies, product lists, notices (Graph API) ◄──┤
            Meta catalog ◄── CatalogSync.gs (on every change + hourly) ◄────┘
            site/admin.html (worker page, PIN) ──POST admin_*──► same web app
```

## How it works

- **The Google Sheet is the database.** The owner can always open it and edit it by hand. The Meta catalog is re-synced hourly, and immediately after any change made through the bot or the worker page.
- **Customers write however they write.** "buenas me regala 2 lbs d tomate chonto y 3 aguacatess xfa" turns into a cart with no AI involved (`Nlu.gs`):
  - normalizes the text, including abbreviations, repeated letters, fractions ("libra y media", "medio kilo") and the unit table in the *Unidades* tab;
  - matches products fuzzily against names and *alias*, with a confidence score;
  - reads 30 intents by rule.
  - On the 574-message messy test set, the rules alone resolve **99.3%**.
- **When unsure, the bot asks; it never guesses.** "¿Tomate chonto, milano o cherry?", "¿Cuánto de lulo?", "El limón se vende por kilo, ¿3 kilos o 3 libras?".
- **AI only as a fallback** (`Llm.gs`, off by default). A local model (Ollama) or Claude Haiku turns hard messages into structured data, which code checks against the catalog. The AI never writes replies, prices or totals. It has budget caps (day, month, per customer) and a circuit breaker; when those trip, the bot keeps working with rules and buttons.
- **The flow.** Cart (typed, or WhatsApp's native catalog cart) → delivery or pickup → address (asks only for what's missing, or accepts a shared location) → name → payment method (from *Config*) → summary with "aprox." for weighed items → confirm.
  - Customers can edit the cart at any time: "quítame el tomate", "mejor 5 aguacates", "lo mismo de siempre".
  - Side questions (hours, prices, "¿hay lulo?") keep the cart.
- **Exactly-once orders.** Confirming uses an idempotency key (a cart version that never resets, plus a hash of the contents) under the script lock. A double tap or a Meta retry can't create two orders or decrement stock twice. Prices always come from the Sheet.
- **A person whenever it matters** (`Handoff.gs`). The bot hands the chat to a person when the customer:
  - writes "asesor", or has a complaint;
  - asks about health or allergies;
  - sends a photo or payment proof (**never auto-verified**);
  - places a large order, or the bot misunderstands them twice.

  Workers get the context and buttons. While a person handles the chat (or answers from the WhatsApp Business app, detected through `smb_message_echoes`), the bot stays silent. If nobody takes the chat within 10 minutes, the backup number is alerted.
- **Workers use commands** from numbers listed in `Trabajadores`:
  - orders: `pedidos`, `confirmar 12`, `en camino 12`, `deshacer 12`;
  - catalog: `precio mango 5500`, `agotado fresa`;
  - chats: `tomar 300…`, `devolver 300…`, `responder 300… texto`;
  - control: `pausar` / `reanudar` (kill switch), `hoy`, `sinresolver`.
- **Safety and privacy.**
  - Guards: pause switch, blocklist, rate limit, bot-loop detection, abuse and injection handling (including leetspeak), card and ID numbers redacted.
  - Ley 1581: data notice and consent recorded, plus `mis datos`, `borrar mis datos` and `baja`. Draft policy in `site/privacidad.html`.
- **24-hour rule.** Status notices go out free-form only inside the window. Outside it, they use a template (`plantilla_estado_pedido`) or the worker is told to write from the app.
- **Modes** (`Config → modo_bot`): `sombra` (workers approve every reply), `asistido` (default: orders wait for ✅) and `autonomo`. See [docs/ROLLOUT.md](docs/ROLLOUT.md).
- **Operations** (`Ops.gs`):
  - every 5 minutes: escalate unattended chats, retry failed order alerts, send one gentle cart reminder;
  - every evening: a summary on WhatsApp covering orders, sales, % resolved without AI, handoffs and AI cost;
  - Mondays: the list of "what the bot didn't understand";
  - daily health check, which e-mails if the WhatsApp token dies;
  - `/health` on the relay.

## Layout

| Path | What |
|---|---|
| `apps-script/Bot.gs` | Webhook entry, the customer conversation (steps, questions, cart, checkout), and worker commands |
| `apps-script/Nlu.gs` | Normalization, units, fuzzy product matching, quantity parsing, intents (no AI) |
| `apps-script/Llm.gs` | Optional AI layer: Ollama or Anthropic, schema validation, budgets, breaker, *Uso* ledger |
| `apps-script/Handoff.gs`, `Guards.gs`, `Privacy.gs`, `Stt.gs`, `Ops.gs`, `Festivos.gs` | Human handoff, protections, Ley 1581, voice notes, jobs/health/summaries, Colombian holidays |
| `apps-script/Orders.gs`, `Catalog.gs`, `CatalogSync.gs`, `WhatsApp.gs`, `Hours.gs`, `Admin.gs`, `Api.gs`, `Jobs.gs`, `Setup.gs`, `Util.gs` | Orders and stock, catalog, Meta catalog sync, Graph client (retries, shadow drafts), hours, worker page API, router, triggers, setup and migrations |
| `relay/` | Cloudflare Worker: signature check, event filtering, optional durable Queue, retries, `/health` |
| `scripts/telegram.js` | **Test the real bot in Telegram**, with local Ollama and voice notes |
| `scripts/nlu-report.js`, `scripts/build-nlu-set.py` | NLU evaluation and the messy-message set generator |
| `tests/` | `npm test`: 121 tests, including the 50-row error matrix, NLU eval, hardening, relay and Telegram |
| `docs/` | Phase 0 docs (PLATFORM_FACTS, GAP_ANALYSIS, COST_MODEL, THREAT_MODEL, DATA_MODEL, FLOWS, OWNER_QUESTIONS), RUNBOOK, ROLLOUT, MANUAL_DUENO (Spanish), setup guides |
| `DECISIONS.md` | Why things are the way they are |

## Testing the bot on Telegram

```bash
ollama serve                        # optional: local AI for messages the rules don't understand
TELEGRAM_TOKEN=123:abc npm run telegram
```

This runs the real `apps-script/` code against the in-memory Sheet (`.telegram-state.json`).
- If Ollama is running with `qwen2.5:14b` (or `OLLAMA_MODEL`), AI is turned on automatically. Use `TELEGRAM_AI=off` to test rules only.
- Chat commands: `/trabajador` (switch between worker and customer), `/reiniciar`, `/tareas` (run the 5-minute jobs now), `/modo sombra|asistido|autonomo`, `/ia on|off`, **`/pedidos`** (see the orders) and **`/exportar`** (save every tab of the simulated Sheet as CSV in `exports/`, to open in Excel).
- Voice notes are transcribed with `DEEPGRAM_API_KEY=...`. Photos, stickers, files and locations behave as they do on WhatsApp.

## Design

The visual system ("market stall": kraft paper, ink green, price-tag labels, Barlow Condensed) is documented in [`design-system/natural-fruver/MASTER.md`](design-system/natural-fruver/MASTER.md). It was generated with the **UI UX Pro Max** skill, which is vendored in `.claude/skills/ui-ux-pro-max/` (MIT), so any Claude Code session in this repo can use it. Icons are Phosphor (MIT) in `site/img/icons.svg`, and fonts are self-hosted in `site/fonts/` (OFL).

## Development

```bash
npm test                         # 121 tests: error matrix, NLU eval, hardening, relay, Telegram
node scripts/nlu-report.js --fails   # NLU accuracy on the messy-message set, and what fails
npm run demo      # regenerate the worker page's demo data after changing Setup.gs
npm run serve     # http://localhost:5173/admin.html — demo mode if API_URL is empty
```

## Deploying

1. Follow **[docs/GUIA.md](docs/GUIA.md)** §1 to create the Sheet, paste the Apps Script, run *Configurar hojas*, and deploy the web app (execute as *me*, access *anyone*). Put the `/exec` URL in `site/js/config.js` for the worker page.
2. Follow **[docs/WHATSAPP.md](docs/WHATSAPP.md)**: Meta app + number (coexistence), Commerce Manager catalog, system-user token → Script Properties (`WA_TOKEN`, `WA_PHONE_ID`, `WA_CATALOG_ID`), `cd relay && npx wrangler deploy` + secrets, webhook subscription to `messages`.
3. GitHub Pages (Source: GitHub Actions) deploys `site/` from `main`: it serves the product photos for the Meta catalog and the worker page.

Optional: use [`clasp`](https://github.com/google/clasp) to push `apps-script/` instead of copy-pasting (`clasp clone <scriptId> --rootDir apps-script`, then `clasp push`). After changing backend code, publish a **new version of the same deployment** (Deploy → Manage deployments → Edit → New version) so the URL doesn't change.

## Known limits / next steps

See the end of [docs/GAP_ANALYSIS.md](docs/GAP_ANALYSIS.md) ("Still open") and [docs/ROLLOUT.md](docs/ROLLOUT.md). In short:
- a payment method on Meta (deadline 30 Sep 2026);
- coexistence onboarding through a Tech Provider or BSP;
- real prices and the Config facts from the owner;
- approved templates;
- legal review of the privacy policy;
- real-device testing and UAT.

Also:
- **WhatsApp carts only take whole quantities.** Typed orders support quarter kilos and half pounds.
- **Meta doesn't allow alcohol in WhatsApp catalogs.** Beers are seeded with `en_whatsapp = no`.
- The Graph API version is pinned in `WhatsApp.gs` (`GRAPH_URL`). Bump it when Meta deprecates it.
