# Cost model

Written 2026-09-28. **The volumes are assumptions** until the owner answers OWNER_QUESTIONS.md, and the unit prices come from PLATFORM_FACTS.md, where several are REPORTED or UNVERIFIED. Re-check both after week 1 of real traffic.

FX assumption: **1 USD ≈ 4,000 COP** (update to the current rate).

## Traffic scenarios (per day)
| | Best | Expected | Worst |
|---|---|---|---|
| Inbound customer messages | 20 | 60 | 200 |
| Bot replies (sends via Cloud API), about 1.3 per inbound after debounce | 26 | 78 | 260 |
| Worker alerts + status notices (API sends) | 5 | 15 | 40 |
| **API sends / month** (×30) | ~930 | ~2,800 | ~9,000 |
| Orders | 3 | 10 | 30 |
| Voice notes | 2 | 6 | 20 |

## 1. WhatsApp (Meta), from 1 Oct 2026 (REPORTED)
- 1,000 free service messages per number per month. After that, a per-message service rate for Colombia. The rate is **unknown**, so I use a placeholder of **USD 0.004 per message**. Replace it with the rate-card value.
- Utility templates inside the window become billable. We avoid them inside the window by sending free-form text there, and use templates only outside it.
- The owner's manual replies from the Business app stay free.

| | Best | Expected | Worst |
|---|---|---|---|
| Billable service sends | 0 | ~1,800 | ~8,000 |
| USD / month (at the 0.004 placeholder) | 0 | ~7 | ~32 |
| Templates outside the window (≈ 2/day at an assumed ~USD 0.008) | ~0.5 | ~0.5 | ~1.5 |

**Lever:** debounce and one-message-per-turn replies cut send counts directly. That's another reason to do §5.5.

## 2. LLM (Claude Haiku 4.5, prices UNVERIFIED: $1/MTok in, $5/MTok out, cache read ≈ $0.10/MTok)
Per LLM call:
- Cached static prefix (instructions + compact 123-product catalog with aliases): ~4,000 tokens, billed as cache reads.
- Uncached input (state summary + last ≤ 6 turns + current text): ~600 tokens.
- Structured output: ~150 tokens.
- **Cost per call ≈** 4,000×0.10e-6 + 600×1e-6 + 150×5e-6 = 0.0004 + 0.0006 + 0.00075 ≈ **USD 0.00175**.
- Without cache hits, each call costs about USD 0.0054 (about 3× more).

Share of messages that reach the LLM (target: layers 0–2 resolve ≥ 85%; button taps never reach the LLM):

| | Best | Expected | Worst |
|---|---|---|---|
| LLM calls/day | 2 (10%) | 9 (15%) | 60 (30%, cache misses) |
| USD / month | ~0.10 | ~0.50 | ~9.7 (at no-cache rate) |

**Guardrails in code:**
- Global budget of USD 10/month, with alerts at 50% and 80% and a circuit breaker at 100%.
- Daily cap of USD 0.60.
- Per phone: 10 calls/hour and 30/day.
- A provider-side Console spend limit of about USD 15/month as the backstop.

## 3. Speech-to-text (optional, D6)
Assume a Whisper-class API at about USD 0.006/min and an average audio of 20 s:

| | Best | Expected | Worst |
|---|---|---|---|
| USD / month | ~0.10 | ~0.40 | ~1.20 |

Cap: 60 s per audio, 5 audios per customer per day, and a global cap of 300 min/month.

## 4. Infrastructure
| Item | Cost | Notes |
|---|---|---|
| Google Sheet + Apps Script | 0 | Quotas far above this volume |
| Cloudflare Worker + D1 + Queue + Durable Objects | 0 – USD 5/month | The free plan may cover SQLite-backed DOs. Queues or higher limits may need Workers Paid ($5). *Verify in Phase 1* |
| GitHub Pages | 0 | Photos and the admin page |
| Uptime monitor | 0 | e.g. UptimeRobot free |
| BSP for coexistence (only if D4 option 2) | ~USD 0–50/month | Depends on the provider |

## Totals (USD / month, COP at 4,000)
| | Best | Expected | Worst |
|---|---|---|---|
| Meta | 0.5 | 7.7 | 33.5 |
| LLM | 0.1 | 0.5 | 9.7 |
| STT | 0.1 | 0.4 | 1.2 |
| Infra (Workers Paid assumed) | 5 | 5 | 5 |
| **Total** | **≈ 5.7 (≈ 23k COP)** | **≈ 13.6 (≈ 54k COP)** | **≈ 49.4 (≈ 198k COP)** |

Not included: a BSP fee (D4) or a paid domain.

**Conclusion:** the biggest variable cost is **Meta's service-message charge**, not the LLM. Keeping replies to one message per turn matters more for cost than model choice.
