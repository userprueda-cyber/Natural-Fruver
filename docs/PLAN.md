# Natural Fruver Pereira — Online Catalog Plan

## Context
A friend runs **Natural Fruver Pereira**, a fruit & vegetable store that currently sells through Instagram posts and WhatsApp. We're building them a catalog that:
1. lets **customers** find products fast and order via WhatsApp,
2. lets **workers** add/edit/remove products and discounts from their phones with no technical skill,
3. keeps stock **in sync automatically**: when a customer orders, the ordered quantity is taken out of the internal catalog.

Constraints: as close to free as possible, low maintenance, Spanish UI, mobile-first (almost all traffic will come from Instagram/WhatsApp on phones). The repo (`userprueda-cyber/Natural-Fruver`) is empty, so everything starts from scratch.

## Architecture (all free tier)

```
 Customers (phone)                      Workers (phone)
       │                                      │
 GitHub Pages static site              Admin web page (Apps Script web app,
 (catalog + cart)                       restricted to their Google accounts)
       │  GET catalog JSON                    │  add / edit / discount / remove / photo
       │  POST order ──────┐                  │
       ▼                   ▼                  ▼
            Google Apps Script API  ◄──►  Google Sheet (the "database")
                                           tabs: Productos · Pedidos · Categorías · Config
       │
       └─► opens WhatsApp (wa.me link) with the order text prefilled
```

- **Google Sheet** is the single source of truth. The owner can always open it directly as a fallback.
- **Google Apps Script** (attached to the sheet) exposes a small JSON API and serves the worker admin page. Its hosting and auth are free, and it uses Google login, so we don't need to build a login system.
- **Public site**: a static site on GitHub Pages. Free, fast, and has a custom domain option (~$15/yr, optional).

## How "ordered → removed from catalog" works
A wa.me link can't tell us whether the customer actually hit send in WhatsApp, and the official WhatsApp Business API costs money and is complex to set up. So the **site records the order itself**:

1. The customer taps **"Enviar pedido por WhatsApp"**.
2. The site POSTs the cart to Apps Script. It **locks the sheet** (`LockService`), checks stock, subtracts the quantities, writes a row to **Pedidos** with status `pendiente` and an order number (e.g. `NF-0142`), and returns that number.
3. The site opens WhatsApp with the message: *"Pedido NF-0142: 2 kg Mango, 1 Aguacate… Total $X. Nombre / dirección…"*.
4. Workers see pending orders on the admin page. They either **confirm** it, or **cancel** it (which returns the stock automatically). Orders left `pendiente` longer than N hours can be auto-cancelled by a time-driven trigger so stock doesn't get stuck.
5. When stock reaches 0, the product shows as **"Agotado"** (or is hidden, configurable).

Produce is sold by kg, unit, bunch, etc., so stock is a number in the product's own unit. Workers who don't want to track exact quantities can just use the **Disponible** on/off switch.

## Data model (Google Sheet)
- **Productos**: `id, nombre, categoría, precio, unidad (kg/lb/unidad/atado/canasta), precio_oferta, oferta_hasta (fecha), stock, disponible (sí/no), destacado, foto_url, descripción, palabras_clave, orden, actualizado`
- **Categorías**: `nombre, icono/emoji, orden` (Frutas, Verduras, Hierbas, Granos, Lácteos, Combos…)
- **Pedidos**: `nro, fecha, items (JSON), total, cliente_nombre, teléfono, dirección, notas, estado (pendiente/confirmado/entregado/cancelado)`
- **Config**: WhatsApp number, store hours, delivery zones and fee, minimum order, banner text, "hide sold-out" toggle

## Features

### Customer site
- Search bar with accent/typo-tolerant matching ("platano" finds "Plátano") plus keywords (e.g. "palta" → aguacate)
- Category chips, a **Ofertas** section (strikethrough price + % badge), and **Destacados**
- Product cards with photo, price per unit, and a quantity stepper (0.5 kg steps where it makes sense)
- Persistent cart (localStorage), with a checkout form (name, address/neighborhood, delivery or pickup, notes) → order recorded → WhatsApp
- Shows store hours and whether it's open now, the delivery fee and minimum order
- Fast on 3G: lazy-loaded, resized images and a cached catalog (the last catalog is shown instantly, then refreshed)
- Share a product link; Open Graph preview for Instagram/WhatsApp link-in-bio

### Worker admin page (Apps Script web app)
- Access restricted to listed Google accounts
- Product list with search, and one-tap **Disponible** toggle and stock +/-
- Add/edit form: name, category, price, unit, discount (price or %) with an end date, and a photo **taken from the phone camera**, which is resized in the browser and saved to a Drive folder
- Remove = archive (soft delete), so history isn't lost
- Pending-orders view: confirm / cancel (restocks) / mark delivered

### Scheduled jobs (Apps Script time triggers, free)
- **Every 15 min**: rebuild the cached catalog JSON (`CacheService`), which keeps the public API fast and within quotas
- **Hourly**: expire discounts past `oferta_hasta`, and auto-cancel stale pending orders (restocking them)
- **Daily (early morning)**: optional summary email or sheet of the previous day's orders and low-stock items

## Repo layout
```
/site            public catalog (plain HTML + CSS + vanilla JS, or Vite + Preact if it grows)
  index.html, app.js, cart.js, search.js, styles.css
/apps-script     Code.gs (API: getCatalog, createOrder, admin CRUD), Admin.html, triggers.gs
  appsscript.json   (deployed with `clasp`)
/sheet-template  CSV headers + sample products for setting up the Sheet
.github/workflows/deploy.yml   deploy /site to GitHub Pages
README.md        setup guide for the owner, in Spanish
```

## Build phases
1. **Sheet + read API**: create the template sheet, then `doGet` → catalog JSON with caching. Seed it with real products from their Instagram price posts.
2. **Public catalog**: listing, search, categories, offers, cart, and a WhatsApp message (no stock write yet). Deploy to GitHub Pages. *Usable MVP at this point.*
3. **Orders + stock**: `doPost` createOrder with LockService, the Pedidos tab, and order numbers in the WhatsApp text.
4. **Worker admin page**: CRUD, photo upload, pending-orders management.
5. **Triggers + polish**: offer expiry, stale-order cleanup, daily summary, SEO/OG tags, and an optional custom domain.

## Things to ask the store owner
- Their WhatsApp business number, hours, delivery zones/fees and minimum order
- Their product list with units and current prices (the Instagram price posts are a good start)
- Whether they want exact stock counts or just an available/sold-out toggle
- Which workers need admin access (their Gmail accounts)
- Brand assets: logo, colors, photos

## Verification
- Apps Script: a test function that creates an order and asserts stock went down, then cancels it and asserts stock was restored. Also fire two concurrent orders for the last unit and check that only one succeeds.
- Site: run it locally (`npx serve site`) and check it at phone width with Playwright (search "platano", add to cart, check out, confirm the wa.me URL contains the correct text and order number).
- End to end: add a product on the admin page from a phone, see it on the site within 15 min (or instantly with cache bust), order it, check the Pedidos row and stock, then cancel and check the restock.
