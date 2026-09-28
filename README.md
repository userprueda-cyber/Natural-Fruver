# Natural Fruver — WhatsApp ordering bot

Customers of **Natural Fruver Pereira** order entirely inside WhatsApp: they browse the store's WhatsApp catalog (photos, prices), send a cart, choose delivery or pickup, and confirm. Workers manage orders, prices, offers and stock by messaging the same bot (or from the Sheet / worker page). It runs on free tiers: Google Sheets + Apps Script + a Cloudflare Worker, plus the WhatsApp Cloud API (replying to customers who write first costs nothing).

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

- **The Google Sheet is the database.** The owner can always open it and edit it by hand. The Meta catalog is re-synced hourly and immediately after any change made through the bot or the worker page.
- **The chat flow** (`Bot.gs`): menu → category list → product lists from the Meta catalog (30 per message) → the customer sends WhatsApp's native cart → the bot re-prices it from the sheet (cart prices are ignored) → delivery or pickup → address (saved for next time; a shared location works) → name → summary with delivery fee → confirm. Free text searches products ("mangos", "queso campesino"). The conversation step lives in the `Clientes` tab and resets after 12 h idle.
- **Confirming reserves stock.** On *Confirmar* the order goes through the same `createOrder_` as before: under a script lock it re-checks availability, subtracts stock, writes a `Pedidos` row (`NF-0042`) and notifies every worker with *Confirmar / Cancelar* buttons. If something sold out while the customer was deciding, it's removed and the customer sees why.
- **Workers use commands** from numbers listed in `Trabajadores.whatsapp`: `pedidos`, `confirmar 12`, `precio mango 5500`, `oferta mango 5000 hasta 15/10`, `stock mango +5`, `agotado fresa`… Status changes message the customer.
- **24-hour rule.** Meta only allows free-form messages to someone who wrote in the last 24 h. Workers can open that window by writing *hola*; otherwise the new-order notice falls back to an approved template (`Config → plantilla_aviso_pedido`).
- **Cancelling returns stock.** Workers confirm → deliver or cancel orders. Cancelling puts tracked stock back. Orders left *pendiente* for `horas_cancelar_pendientes` hours (default 3) are cancelled automatically, so fake or abandoned orders don't lock up stock.
- **Stock is optional per product.** An empty `stock` cell means "not counted" (only the *disponible* switch matters). A number means it's decremented per order. `kg`/`lb` products sell in 0.5 steps.
- **Offers expire on their own.** `precio_oferta` + optional `oferta_hasta` date.
- **Workers log in with a PIN**, not a Google account (tab `Trabajadores`). Every change records who made it. Ten wrong PINs lock the admin for 10 minutes.
- **Scheduled jobs** (Apps Script triggers): sync the WhatsApp catalog and cancel stale orders hourly, refresh the catalog cache every 15 min, and an optional daily 6 am email summary of yesterday's orders and low stock.

## Layout

| Path | What |
|---|---|
| `apps-script/` | Backend: `Api.gs` (router), `Bot.gs` (WhatsApp conversation + worker commands), `WhatsApp.gs` (Graph API client), `CatalogSync.gs` (Meta catalog), `Hours.gs`, `Orders.gs`, `Admin.gs`, `Catalog.gs`, `Jobs.gs` (menu + triggers), `Setup.gs` (tabs, product data, admin PIN, relay secret), `Util.gs`, `appsscript.json` |
| `relay/` | Cloudflare Worker that receives Meta's webhook, verifies `X-Hub-Signature-256` and forwards messages to Apps Script (`wrangler.toml`) |
| `site/` | GitHub Pages: `index.html` just sends visitors to WhatsApp (for the Instagram bio link); `admin.html` is the worker page; `img/` hosts the logo and the 600×600 product photos the Meta catalog loads |
| `site/data/demo-catalogo.json` | Sample data for the worker page's demo mode (`npm run demo`) |
| `tests/` | `node --test` suites. `gas-mock.js` runs the real `.gs` files against in-memory Sheets/Cache/Lock/Drive/UrlFetch mocks; `bot.test.js` drives whole WhatsApp conversations; `relay.test.js` covers the worker |
| `.github/workflows/site.yml` | Runs tests on every push; deploys `site/` to GitHub Pages from `main` |

## Design

The visual system ("market stall": kraft paper, ink green, price-tag labels, Barlow Condensed) is documented in [`design-system/natural-fruver/MASTER.md`](design-system/natural-fruver/MASTER.md). It was generated with the **UI UX Pro Max** skill, which is vendored in `.claude/skills/ui-ux-pro-max/` (MIT), so any Claude Code session in this repo can use it. Icons are Phosphor (MIT) in `site/img/icons.svg`, and fonts are self-hosted in `site/fonts/` (OFL).

## Development

```bash
npm test          # backend + bot conversations (via mocks), relay, shared logic
npm run demo      # regenerate the worker page's demo data after changing Setup.gs
npm run serve     # http://localhost:5173/admin.html — demo mode if API_URL is empty
```

## Deploying

1. Follow **[docs/GUIA.md](docs/GUIA.md)** §1 to create the Sheet, paste the Apps Script, run *Configurar hojas*, and deploy the web app (execute as *me*, access *anyone*). Put the `/exec` URL in `site/js/config.js` for the worker page.
2. Follow **[docs/WHATSAPP.md](docs/WHATSAPP.md)**: Meta app + number (coexistence), Commerce Manager catalog, system-user token → Script Properties (`WA_TOKEN`, `WA_PHONE_ID`, `WA_CATALOG_ID`), `cd relay && npx wrangler deploy` + secrets, webhook subscription to `messages`.
3. GitHub Pages (Source: GitHub Actions) deploys `site/` from `main`: it serves the product photos for the Meta catalog and the worker page.

Optional: use [`clasp`](https://github.com/google/clasp) to push `apps-script/` instead of copy-pasting (`clasp clone <scriptId> --rootDir apps-script`, then `clasp push`). After changing backend code, publish a **new version of the same deployment** (Deploy → Manage deployments → Edit → New version) so the URL doesn't change.

## Known limits / next steps

- **Prices are reference values** from the seed; the owner must set real ones before going live. Delivery fee and free-delivery threshold are placeholders too.
- **WhatsApp carts only take whole quantities**, so kg products are ordered in whole kilos (other amounts go in the order note).
- **Meta doesn't allow alcohol in WhatsApp catalogs**: beers are seeded with `en_whatsapp = no`.
- The Graph API version is pinned in `WhatsApp.gs` (`GRAPH_URL`); bump it when Meta deprecates it.
- Apps Script quotas (about 30 simultaneous executions, 6 min/run) are far above a single store's traffic, and the catalog is served from cache.
- The PIN lockout is global, so someone guessing PINs can lock workers out for 10 minutes. If that becomes a problem, move the admin to Google sign-in.
