# Natural Fruver — Design System (MASTER)

Global source of truth for `site/index.html` (store) and `site/admin.html` (workers).
Generated with the **UI UX Pro Max** skill (`.claude/skills/ui-ux-pro-max`) and then narrowed to the chosen direction: **market stall** (plaza de mercado).
Page-specific overrides go in `pages/<page>.md`; none exist yet.

## How it was derived

| Search | Result used |
|---|---|
| `"local produce market grocery" --design-system` | Base structure: e-commerce product grid, no shadows, fast 150 ms color transitions, pre-delivery checklist. Its generic emerald/mint palette and Rubik were **rejected**: they read as a stock template, which is what we're moving away from. |
| `"farm earth" --domain color` | **Agriculture/Farm** palette: earth green + harvest gold. Darkened and warmed below. |
| `"retro warm paper" --domain style` | **E-Ink / Paper**: off-white paper, ink text, 1px hairline borders, subtle grain, no gradients. |
| `"bold condensed headline" --domain typography` | **Barlow Condensed + Barlow**: condensed type like printed market price signs, from one family, with full Spanish glyphs. |
| `"icon button accessible label" --domain icons` | **Phosphor** (regular weight) as the only icon family. Decorative icons get `aria-hidden`, and icon-only buttons get an `aria-label`. |

## Tokens

All text/background pairs below were checked at ≥ 4.5:1 (WCAG AA).

| Token | Light | Dark ("pizarra") | Use |
|---|---|---|---|
| `--paper` | `#F4EEE1` | `#121714` | page background (kraft cream / chalkboard) |
| `--surface` | `#FFFCF5` | `#1A221D` | cards, sheets, inputs |
| `--ink` | `#1E2B22` | `#ECE6D8` | primary text, strong borders, cart bar |
| `--muted` | `#5A6459` | `#A9B2A5` | secondary text |
| `--line` | `#D9CFBC` | `#2F3B33` | hairlines |
| `--green` | `#1F5C3A` | `#8FCB9F` | primary action, active tab, "abierto" |
| `--green-soft` | `#E4ECDF` | `#1F2F25` | selected/soft fills |
| `--gold` | `#8A5A06` | `#E2B458` | highlights, "pendiente" |
| `--tag` | `#EBDDBE` | `#3B3324` | price-tag labels, banner |
| `--red` | `#B42318` | `#F28B7D` | offers, errors, cancel |

- **Type:** (self-hosted in `site/fonts/`, SIL OFL; no Google Fonts request) Barlow Condensed 600/700 for display: wordmark, section titles, prices, tabs and buttons, usually uppercase with +0.02em tracking. Barlow 400–600 for body at 16 px / 1.5. Numbers use `font-variant-numeric: tabular-nums`.
- **Shape:** radius 6 px (controls, cards) and 10 px (bottom sheets). No drop shadows on cards; hairline borders instead. Floating bars only get one soft shadow.
- **Spacing:** 4 / 8 / 12 / 16 / 24 / 32 px. Page gutter 16 px (24 px ≥ 768 px). Content max width `--maxw` 1120 px (760 px on the workers' page); the header, banners and grid all align to `--edge`.
- **Motion:** 150 ms color/opacity only. No layout-shifting press states. `prefers-reduced-motion` disables animation.
- **Touch:** every control ≥ 44 × 44 px.

## Signature elements

- **Price tag:** a kraft label with a notched left edge (`clip-path`) and a punched hole, with the price in condensed bold and a small unit (`/ kg`).
- **Offer stamp:** red outlined "OFERTA −17%", rotated −3°, on the photo corner.
- **Placeholder tile:** when there's no photo, the product's initial in condensed type on a category-tinted crate color with faint slats. Category hues are fixed per category family. Never emoji.
- **Receipt:** cart lines and order items use dotted leaders between name and amount.
- **Section rules:** condensed uppercase title followed by a hairline that runs to the edge.

## Anti-patterns (do not reintroduce)

- Emoji as icons or as image placeholders.
- Pill-shaped everything, floating soft-shadow cards, mint/emerald "health app" palettes.
- Gradients, glassmorphism, and centered hero cards on the login screen.
- Text < 12 px, gray-on-gray, raw hex values inside components (use tokens).

## Pre-delivery checklist

- [ ] No emoji icons; every icon comes from `site/img/icons.svg` (Phosphor regular)
- [ ] Contrast ≥ 4.5:1 in light **and** dark (check dark separately)
- [ ] Visible focus ring on every interactive element
- [ ] Touch targets ≥ 44 px, and nothing hidden behind the bottom safe area
- [ ] No horizontal scroll at 375 px; test 768, 1024 and 1440
- [ ] `prefers-reduced-motion` respected
