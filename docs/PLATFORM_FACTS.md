# Platform facts (WhatsApp Cloud API, Meta pricing, LLM)

Checked **2026-09-28**. Each fact has a status:

- **VERIFIED**: read on an official Meta or Anthropic page on that date.
- **REPORTED**: several third-party sources agree, but I couldn't confirm it on an official page (the official page was stale, blocked, or I couldn't fetch it).
- **UNVERIFIED**: comes from prior knowledge or the existing code, and hasn't been re-checked yet.

Re-check anything that isn't VERIFIED before Phase 1 code depends on it. Web tools failed intermittently during this session, so several items stay REPORTED or UNVERIFIED.

---

## 🚨 Time-critical

| Fact | Status | Source |
|---|---|---|
| From **1 Oct 2026**, *service* messages (free-form replies inside the 24 h window) become chargeable after a free allowance of **1,000 service messages per business phone number per month**. | REPORTED | [Courier](https://www.courier.com/blog/whatsapp-pricing-changes-october-2026), [bitbybit](https://bitbybit.studio/blog/whats-new/whatsapp-business-api-pricing-2026/), [Zendesk](https://support.zendesk.com/hc/en-us/articles/11113277351322-Announcing-upcoming-changes-to-WhatsApp-Business-messaging-pricing), [MEF, 2026-09-28](https://mobileecosystemforum.com/2026/09/28/whatsapp-puts-a-price-on-customer-support-what-metas-october-changes-mean-for-business-messaging/), [techweez](https://techweez.com/2026/09/28/whatsapp-business-pricing-october-2026/) |
| **Utility templates sent inside an open window become chargeable** again from 1 Oct 2026 (free since July 2025). | REPORTED | same sources |
| A **payment method must be on the WhatsApp Business Account by 30 Sep 2026**. Without one, delivery of newly chargeable service messages may be **suspended**. | REPORTED | same sources |
| Meta's official pricing page, as fetched on 2026-09-28, still said "service conversations are free" and "utility templates delivered within an open customer service window are free". It did **not** yet describe the 1 Oct change. | VERIFIED (that the page is stale) | [developers.facebook.com … /whatsapp/pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) |

**Action for the owner:** check today in **WhatsApp Manager → Resumen / Facturación** (or Business Settings → Payments) whether the account shows the notice. If it does, add a payment method **before 30 Sep 2026**. The bot's own messages would count against the 1,000/month allowance. The Business app's manual messages stay free (see coexistence below).

## Pricing (other)
| Fact | Status | Source |
|---|---|---|
| Pricing is per delivered message, by category (marketing, utility, authentication, service) and recipient country. | VERIFIED | official pricing page |
| Free Entry Point: after a user arrives via a Click-to-WhatsApp ad or a Facebook Page CTA, everything is free for 72 h. | VERIFIED | official pricing page |
| Colombia got higher utility and authentication rates from 1 Oct 2025. Exact COP/USD rates are in Meta's rate-card CSV. | VERIFIED (existence) / rates UNVERIFIED | official pricing page |
| Messages the owner sends **manually from the Business app** stay free under coexistence. Only Cloud API sends are billed. | VERIFIED | [Onboarding Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/) |

## Coexistence (same number in the Business app + Cloud API)
| Fact | Status | Source |
|---|---|---|
| **Only a Solution Partner or Tech Provider can onboard a Business-app number into Cloud API**, through Embedded Signup. | VERIFIED | Meta coexistence doc (above) |
| Our `docs/WHATSAPP.md` §2 describes a self-serve "Connect your existing WhatsApp Business app" button inside our own Meta app. That conflicts with the doc above, and this is the **#1 open platform risk**. Options: (a) register our Meta app as a Tech Provider for the shop's own portfolio (check that this is allowed for a single business); (b) use a BSP that supports coexistence (360dialog, YCloud…), which adds a monthly fee and a vendor; (c) migrate the number fully to the API, so the owner loses the Business app on that number. | open | — |
| Requires WhatsApp Business app **v2.24.17+**. | VERIFIED | Meta doc |
| Throughput on a coexisting number is fixed at **20 mps** (some BSPs say 5 mps). Either way it's far above our needs. | VERIFIED (20) | Meta doc |
| Messages the owner sends from the app arrive as **`smb_message_echoes`** webhooks. **This is how the bot detects "owner replied manually" and goes silent** (error-matrix row 37). | VERIFIED | Meta doc |
| Group chats aren't synced. Disappearing messages are turned off in 1:1 chats. BSPs report that broadcast lists are disabled, and that API-side calls and some companion devices (Windows, WearOS) aren't supported. | VERIFIED (groups, disappearing) / REPORTED (rest) | Meta doc; [SalesHiker](https://saleshiker.com/kb/whatsapp-coexistence-connect-whatsapp-business-apps-to-whatsapp-api/limitations-of-whatsapp-co-existence-business-app-cloud-api/), [YCloud](https://www.ycloud.com/blog/whatsapp-business-app-coexistence-meta-update) |
| The app must be opened every ~10–14 days or the link may expire. A 7-day minimum of prior app use may apply. | REPORTED (BSPs; not in Meta doc) | [360dialog](https://docs.360dialog.com/docs/resources/phone-numbers/coexistence) |

## Messaging mechanics
| Fact | Status | Notes / source |
|---|---|---|
| Free-form messages are only allowed within **24 h of the customer's last inbound message**. Outside it, only templates. | UNVERIFIED (long-standing; the code relies on it) | `WhatsApp.gs` `waNeedsTemplate_` |
| Error **131047** means "re-engagement required (more than 24 h)". | UNVERIFIED | `WhatsApp.gs` |
| Reply buttons: max 3, title ≤ 20 chars. Lists: max 10 rows, row title ≤ 24, description ≤ 72, button text ≤ 20. Interactive body ≤ 1024. Text body ≤ 4096. Product list ≤ 30 items. | UNVERIFIED (encoded in `WhatsApp.gs` constants) | re-check against the interactive-messages docs |
| Inbound media must be fetched via `GET /{media-id}` to get a short-lived URL, which is widely reported to expire after about 5 minutes. | UNVERIFIED | |
| Typing indicator: sent with the read-receipt call (`status: read` + `typing_indicator: {type: text}`). It shows for up to ~25 s. | UNVERIFIED | `waMarkRead_` exists but isn't used on inbound messages |
| Webhooks: Meta retries failed deliveries with backoff for up to ~7 days, and duplicates are possible. The endpoint must answer 2xx quickly. Signature header: `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret). | UNVERIFIED (fetch failed) | the relay already implements the signature check |
| Status webhooks (`sent/delivered/read/failed`) arrive on the same `messages` field. | UNVERIFIED | the relay currently **drops** them |
| Graph API version pinned in code: **v23.0**. Meta supports each version for about 2 years. Check its deprecation date. | UNVERIFIED | `WhatsApp.gs` `GRAPH_URL` |
| A System User token with "Never" expiry is supported. It is revoked if the system user or the app's permissions change. | UNVERIFIED | |

## Policy
| Fact | Status | Source |
|---|---|---|
| From 15 Jan 2026, the WhatsApp Business Solution Terms bar **general-purpose AI assistants** (where the AI itself is the product). Business-specific support and ordering bots remain allowed. | REPORTED (prompt's sources; my search failed) | respond.io "Not All Chatbots Are Banned" (per master prompt). Re-check the official Business Solution Terms. |
| Meta doesn't allow alcohol in WhatsApp catalogs. | UNVERIFIED (already handled: beers `en_whatsapp = no`) | |
| Opt-out: businesses must honor opt-out requests. Quality rating drops with blocks and reports. | UNVERIFIED | |

## LLM (Anthropic)
| Fact | Status | Notes |
|---|---|---|
| The cheap, fast model is **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`). | VERIFIED (from the environment's model list) | |
| Haiku 4.5 costs about **$1 / MTok input** and **$5 / MTok output**. Cache writes cost about 1.25× input (5-min TTL), cache reads about 0.1× input. | UNVERIFIED (prior knowledge; my `claude-api` lookup failed) | used in COST_MODEL.md |
| Prompt caching needs a minimum prefix length (a few thousand tokens for Haiku-class models). Our static prefix (instructions + compact catalog of 123 products with aliases) must clear that minimum, or caching silently won't apply. | UNVERIFIED | measure in Phase 3 |
| Structured output can be forced with tool use (`tool_choice` forced) or JSON-schema output. | UNVERIFIED | |
| The Console supports workspace/org **spend limits**. That's our provider-side backstop. | UNVERIFIED | document exact steps in Phase 3 |

## Still to check (next pass, before Phase 1)
1. The official Meta announcement of the 1 Oct 2026 change: allowance scope (per number or per WABA), per-message service rate for CO, and what happens without a payment method.
2. Whether a single business can be its own "Tech Provider" for coexistence, or whether we need a BSP.
3. Webhook retry window and timeout (official page).
4. Current interactive-message limits and typing-indicator API.
5. Official Business Solution Terms text on AI.
6. Haiku 4.5 pricing and minimum cache length (run the `claude-api` skill).
