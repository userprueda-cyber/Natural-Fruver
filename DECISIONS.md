# Decisions

Each entry covers the choice, the alternatives, and why. Newest at the bottom. Status is one of *proposed* (waiting for review), *accepted* or *superseded*.

---

## D1 — Evolve the existing bot instead of rebuilding (accepted, 2026-09-28)
**Choice:** keep the working Sheet + Apps Script + Cloudflare relay bot and close the gaps listed in `docs/GAP_ANALYSIS.md`.
**Alternatives:** (a) rebuild on TS + Fastify + Postgres as the master prompt suggests; (b) a hybrid where the Sheet stays the catalog and a new TS service runs the chat.
**Why:**
- The current bot already covers the catalog, native cart, re-pricing in code, stock locking, worker commands and whole-conversation tests.
- The owner already knows the Sheet, and it runs at zero fixed cost.
- A rebuild would throw away tested behaviour to fix problems that are mostly at the edges: durability, ordering, handoff and NLU.

**Deviation from the master prompt:** no Postgres or Fastify. Each prompt requirement is still met; D2 and D3 describe the substitutes.

## D2 — Make the Cloudflare side the durable front door (accepted in part, 2026-09-28)
**Choice:** grow `relay/worker.js` from a stateless forwarder into:
1. **D1 (SQLite) `inbox` table** with a UNIQUE key on `wamid`. It gives durable dedupe (row 2), replay after an outage (row 5), and old-event rejection. Status webhooks go into `status_events`.
2. **One Durable Object per customer phone.** It acts as a mutex so messages are processed one at a time and in order (rows 3, 45). A ~5 s **alarm** debounces bursts and merges them into one turn (§5.5). It also holds the fast-changing conversation state: cart, step, handoff flag and 24 h window timestamps.
3. **Cloudflare Queue** (or DO alarm retries) with capped exponential backoff when calling Apps Script and the Graph API. Items that keep failing land in a dead-letter table, and the owner gets an alert (rows 9, 13, 47).
4. The Worker verifies `phone_number_id` and the signature as it does today, and still acks 200 in under a second.

**Alternatives:**
- Keep everything in Apps Script, using LockService + CacheService. There is no durable queue, no per-key lock (only a global script lock), and cache entries can be evicted.
- A small VPS with Postgres. That adds a server to patch and a monthly bill.

**Why:**
- Durable Objects give a per-customer serial executor with alarms, which is exactly what §5.5 needs, with no extra infrastructure.
- D1 gives unique indexes.
- Everything likely stays on the free tier or the $5/month Workers Paid plan. Durable Objects on the free plan are limited to SQLite-backed DOs; *verify*.
- The owner still never touches any of it.

**Risks:**
- Two runtimes (Worker and Apps Script) to keep consistent.
- DO/D1/Queues free-tier limits need checking in Phase 1.

## D3 — Where the "brain" runs (superseded by D9)
**Choice:** the Worker runs everything message-side (the conversation pipeline):
- guards and normalization;
- deterministic NLU;
- the LLM call;
- the state machine;
- outgoing sends.

**Apps Script** stays the system of record for:
- the catalog (read through a cached JSON endpoint that already exists, `?action=catalogo`);
- orders and stock, via `createOrder_` under the script lock, now with an idempotency key;
- worker admin and triggers.

**Alternatives:**
- Keep the conversation in `Bot.gs` and add LLM calls through UrlFetch.

**Why:**
- Latency: Apps Script cold runs take several seconds and read the Sheet on every message.
- Apps Script limits: about 30 concurrent executions, 6 min per run, UrlFetch quotas.
- Security: the LLM and STT keys stay in Worker secrets, away from the Sheet owner's Google account.
- Tooling: the Worker is testable in plain Node with `node --test`.

**Cost:**
- `Bot.gs` logic has to be ported to the Worker, keeping the existing conversation tests as the spec.
- **Alternative if this is too much:** phase it. Phase 1 adds only durability (D2) and keeps forwarding to `Bot.gs`. The conversation moves in Phase 2.

**Language:** plain JS (ES modules) to match the repo, with JSDoc types. **Deviation:** no TypeScript build step for now, which keeps `wrangler deploy` trivial. Revisit if the Worker code passes about 2k lines.

## D4 — Coexistence stays the goal, but onboarding needs a partner (proposed, blocking)
**Choice:** keep the owner's Business app on the same number (coexistence).
**Finding:** Meta's doc says only Tech Providers or Solution Partners can onboard a Business-app number (PLATFORM_FACTS). `docs/WHATSAPP.md` §2 assumes self-serve.
**Options, in order of preference:**
1. Check whether our own Meta app can be registered as a Tech Provider serving just this business.
2. Use a BSP with coexistence support. This adds a monthly fee and a vendor dependency.
3. Migrate the number fully to Cloud API. The owner would then answer through an inbox tool instead of the app.

**Known downsides of coexistence:**
- The owner must open the app every ~2 weeks.
- Group chats aren't synced and disappearing messages are off.
- Broadcast lists may be disabled.
- Throughput is fixed, which is irrelevant at this volume.

**Upside:** the owner's manual replies are free, and they arrive as `smb_message_echoes` webhooks. That is how the bot detects "the owner is handling this chat" (row 37).

## D5 — LLM: optional and capped (accepted; the provider is now pluggable, see D10)
**Choice:** `claude-haiku-4-5-20251001` with a forced structured output, temperature 0, `max_tokens` ≈ 300, and a cached static prefix. It is called **only** when layers 0–2 are below confidence.
**Guardrails:**
- A usage ledger in D1.
- Global day/month budget → circuit breaker to menu mode.
- Per-phone hourly and daily limits.
- A provider-side spend limit in the Console.

**Why:** cheapest capable model. The deterministic layers carry most traffic, so the LLM is an accuracy boost, not a dependency.

## D6 — Voice notes: off until the owner opts in (accepted; provider Deepgram, see Stt.gs)
**Choice:** in Phase 2, audio gets an honest "¿me lo escribe o le paso con un asesor?". STT (cheapest capable provider, ≤ 60 s, per-customer daily cap) arrives in Phase 3 behind a config flag, and any transcript with money-relevant content is confirmed with the customer before acting on it.

## D7 — Tone (pending owner)
The bot says "tú" today, while the master prompt defaults to "usted". Keep whatever the owner uses when answering by hand. It's one of the owner questions.

## D8 — Do not delete `repo/` without asking (accepted)
It looks like an older partial copy of the project. It stays untouched until the developer confirms.

## D9 — The brain stays in Apps Script; the relay adds durability only (accepted, 2026-09-28)
**Choice:** conversation logic, NLU, AI calls and state all live in `apps-script/`. The Cloudflare relay:
- verifies the signature and filters to our number and the useful events (messages, app echoes, failed statuses);
- enqueues to a Cloudflare Queue (optional, recommended) or retries 3 times;
- serves `/health`.

**Why this revises D3:**
1. **Testability.** The owner-facing test channel is Telegram (`npm run telegram`), which runs the *real* `.gs` files against the Sheet mock. With the brain in the Worker there would be two runtimes to test.
2. **One place to deploy and debug.** The owner's developer already knows this stack.
3. **Latency is acceptable.** The relay acks Meta in milliseconds, and Apps Script answers in about 1–3 s.

**What we gave up from D2:**
- A per-customer Durable Object. Burst merging is done in Apps Script instead: `collectBurst_` holds the text in the cache and waits `espera_rafaga_seg`, and only the last execution answers.
- The durable wamid store. Dedupe is the cache (6 h) plus idempotent order keys, and events older than 24 h are dropped.

The remaining risk is a burst arriving exactly at a cache eviction. At this shop's volume that's unlikely, and the idempotency key makes it harmless for orders.

## D10 — AI provider is pluggable: Ollama (local) or Claude Haiku (accepted, 2026-09-28)
**Choice:** `Config → ia_proveedor = ollama | anthropic`. Both return the same schema, and `validateLlm_` checks it in code.
- **Default for testing: Ollama** with `qwen2.5:14b` on the developer's Mac (costs nothing, and data stays local).
- **Recommended for production: Claude Haiku 4.5.** It needs no always-on computer, answers in about 1 s against 7–40 s locally, and costs about US$1/month in the expected scenario (docs/COST_MODEL.md, update).
- If the owner insists on local: Cloudflare Tunnel plus Access service token (docs/RUNBOOK.md).

**Measured with qwen2.5:14b (2026-09-28):**
- Good at simple extraction.
- Misclassifies intents: an order came back labelled "status".
- Guesses products from descriptions: "fruta peluda" came back as pitaya.
- Missed an injection written in Spanish, and copied products from the chat history.

**Mitigations in code:**
- items with product + quantity are treated as an order;
- AI items must appear in the current message;
- AI-picked products that the text doesn't clearly name are confirmed with the customer ("¿Te refieres a…?");
- injection is checked by rules first, including leetspeak.

## D11 — Default mode is `asistido` (accepted)
Orders wait for a worker's ✅ unless `modo_bot = autonomo`. That's safer while real prices and policies are still placeholders. See docs/ROLLOUT.md.

## D12 — Quarter-kilo steps for kg products (accepted)
"Media libra" (0.25 kg) is a very common order in Pereira. kg products now sell in 0.25 steps, lb in 0.5, and everything else in whole units. A converted quantity that doesn't fit the step is rounded and marked "(aprox.)" in the reply; it's never changed silently.

## D13 — Plain JavaScript, no TypeScript (accepted)
Apps Script runs `.gs` (V8), and the tests run the same files through `vm`. Adding a TS build would split what's tested from what's deployed. **Deviation from the master prompt, on purpose.**
