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

## D2 — Make the Cloudflare side the durable front door (proposed)
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

## D3 — Where the "brain" runs (proposed)
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

## D5 — LLM: Claude Haiku 4.5, optional and capped (proposed)
**Choice:** `claude-haiku-4-5-20251001` with a forced structured output, temperature 0, `max_tokens` ≈ 300, and a cached static prefix. It is called **only** when layers 0–2 are below confidence.
**Guardrails:**
- A usage ledger in D1.
- Global day/month budget → circuit breaker to menu mode.
- Per-phone hourly and daily limits.
- A provider-side spend limit in the Console.

**Why:** cheapest capable model. The deterministic layers carry most traffic, so the LLM is an accuracy boost, not a dependency.

## D6 — Voice notes: off until the owner opts in (proposed)
**Choice:** in Phase 2, audio gets an honest "¿me lo escribe o le paso con un asesor?". STT (cheapest capable provider, ≤ 60 s, per-customer daily cap) arrives in Phase 3 behind a config flag, and any transcript with money-relevant content is confirmed with the customer before acting on it.

## D7 — Tone (pending owner)
The bot says "tú" today, while the master prompt defaults to "usted". Keep whatever the owner uses when answering by hand. It's one of the owner questions.

## D8 — Do not delete `repo/` without asking (accepted)
It looks like an older partial copy of the project. It stays untouched until the developer confirms.
