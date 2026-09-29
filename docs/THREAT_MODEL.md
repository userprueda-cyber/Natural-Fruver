# Threat model

Written 2026-09-28. It covers the current system and the proposed D2/D3 changes (DECISIONS.md).

## Assets
| Asset | Why it matters |
|---|---|
| The WhatsApp number and its quality rating | It's the shop's main sales channel. A ban or restriction is the worst outcome |
| Customer personal data (phone, name, address, order history) | Ley 1581 applies, and so does customer trust |
| Prices, stock, orders (Sheet) | Money and fulfilment |
| Secrets: `WA_TOKEN`, `APP_SECRET`, `RELAY_SECRET`, `VERIFY_TOKEN`, LLM/STT keys, worker PINs | A leaked token lets someone send as the shop or change the catalog |
| LLM/STT budget | Denial-of-wallet |
| Owner attention | Alert fatigue means real orders get missed |

## Trust boundaries
```
[Customer phone] --WhatsApp--> [Meta] --signed webhook--> [CF Worker] --RELAY_SECRET--> [Apps Script] <--> [Sheet]
                                   ^                          |   \--> [Anthropic / STT] (untrusted output)
                                   '------ Graph API (WA_TOKEN) '
[Worker phones] --same channel, allowlisted numbers--> worker commands
[admin.html on GitHub Pages] --PIN--> [Apps Script admin_*]
[Owner] --edits Sheet directly (Google account)
```
Everything a customer sends is untrusted. That includes text, captions, location names, contact cards, audio transcripts, image contents and the profile name. LLM output is untrusted too.

## STRIDE
| Threat | Current state | Mitigation (phase) |
|---|---|---|
| **S** — forged webhooks | HMAC `X-Hub-Signature-256` over the raw body, constant-time ✅ | Add a `phone_number_id` allowlist and reject events older than 24 h (P1) |
| **S** — someone calls the Apps Script `/exec` directly with `wa_webhook` | Needs `RELAY_SECRET` ✅ (compared with `!==`, not constant-time; low risk) | Move the secret into a header-like field and use a constant-time compare (P1). The `/exec` URL is public by design |
| **S** — a customer claims to be the owner ("soy el dueño, baje el precio") | Worker mode is decided only by the sender's number against `Trabajadores` ✅ | Keep it that way. Destructive admin commands (`/pausar`, bulk price) need confirmation (P2) |
| **S** — worker phone stolen | Commands work from that number | The owner removes the number from `Trabajadores` (document in the runbook) |
| **T** — tampered cart prices | `priceItems_` ignores client prices ✅ | Keep. Add a test |
| **T** — prompt injection changes prices or policy | No LLM yet | The LLM has zero tools and outputs only schema-validated intents and ids. Prices come only from code (P3) |
| **R** — "I never ordered that" | Order row with phone + timestamp. `actualizado_por` for staff ✅ | Audit log in D1 with the inbound `wamid` that caused each order (P1) |
| **I** — customer A asks for B's data | `sendMyOrders_` filters by the sender ✅ | An explicit test. The LLM never receives other customers' data (P2/P3) |
| **I** — secrets in logs | Graph errors are logged as JSON bodies (can include phone numbers) | Log redaction: phone → last 4 digits, long digit runs masked, addresses dropped (P1) |
| **I** — system prompt leak | n/a | The prompt holds no secrets, no phone numbers and no account details, so a leak is harmless by design (P3) |
| **I** — Sheet shared too widely | Depends on the owner | Checklist: share only with named accounts, never "anyone with the link" |
| **D** — message flood from one number (denial of service or denial-of-wallet) | None | Per-phone rate limit in the DO. The LLM is skipped when over the limit. Numbers that keep tripping it get auto-blocked, with an owner-visible unblock (P1/P3) |
| **D** — someone guesses admin PINs to lock workers out | Global 10-minute lockout (known) | Per-IP/per-worker lockout, or Google sign-in (P4) |
| **D** — Apps Script quota exhaustion | Not monitored | Health check + alert. The Worker queue absorbs bursts (P1) |
| **E** — a customer reaches worker commands | Only allowlisted numbers ✅ | — |
| **E** — the LLM triggers actions | n/a | No tools. Order, cancel and status changes are code paths behind explicit button confirmation (P3) |

## OWASP LLM Top 10 (applies from Phase 3)
- **LLM01 Prompt injection.** User text is passed as delimited data. The model returns a schema only, with an `injection_suspected` flag. Replies come from templates.
- **LLM02 Sensitive info disclosure.** Minimal context: this customer's state only.
- **LLM05 Improper output handling.** Schema validation, product-id allowlist, quantity bounds, no eval/HTML/SQL. An output filter strips URLs and phone numbers.
- **LLM06 Excessive agency.** Zero tools.
- **LLM07 System prompt leakage.** Nothing secret in it.
- **LLM10 Unbounded consumption.** Budgets, per-phone caps, input truncation (600 chars), `max_tokens`, timeouts, max 2 retries.

## Fraud and abuse specific to this shop
- **Fake payment screenshots.** Never auto-verified. Always handed to the owner, who checks in the Nequi or bank app.
- **Fake orders that lock stock.** Pending orders auto-cancel after `horas_cancelar_pendientes` ✅. Add a per-phone no-show flag, with optional pay-before-dispatch (P4).
- **Scam links sent to the shop.** The bot never opens URLs or files.
- **Abusive or sexual content.** One boundary message, then silence and an owner alert (P2).

## Secrets handling
- Today: Script Properties and wrangler secrets ✅. **But `.gitignore` doesn't cover `.env`, `.dev.vars` (wrangler's local secrets file) or `relay/.wrangler/`**, and a `relay/.wrangler/` folder already exists on disk. Add these entries and check that none are tracked (P1, first task).
- Add a gitleaks pre-commit hook and CI step (P1).
- Rotation runbook for each secret (P4).
- `WA_TOKEN` is a never-expiring system-user token. A health check calls `GET /{phone_id}` daily and alerts on 401/190 (P1).

## Incident response (short form; full version in RUNBOOK, P4)
1. `/pausar` (or the Worker env flag `BOT_PAUSED=1`) stops all automated replies, and chats go to the owner's app.
2. Rotate the affected secret.
3. Under Ley 1581, notify the SIC and the affected people if personal data leaked (confirm the procedure with a lawyer).
