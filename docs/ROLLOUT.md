# Rollout (Phase 5): shadow → assisted → autonomous

The mode is one cell in the Sheet: **Config → `modo_bot`**. You can move back a step at any time, and `pausar` always works.

| Mode | What customers see | What workers do |
|---|---|---|
| `sombra` (shadow) | Nothing from the bot until a worker approves it | Every reply arrives as "📝 Borrador para +57…" with ✅ Enviar / 🗑️ Descartar |
| `asistido` (assisted, **default**) | Instant answers to questions, and orders are taken | Every order stays *pendiente* until a worker taps ✅ Confirmar |
| `autonomo` | Same, and normal orders are confirmed immediately | Only large orders (`pedido_grande_desde`) wait for review; workers prepare and deliver |

## Before switching on (blocking)
- [ ] Payment method added in Meta Business / WhatsApp Manager (**deadline 30 Sep 2026**). See PLATFORM_FACTS.
- [ ] Coexistence onboarding done (see DECISIONS D4: this needs a Tech Provider or BSP).
- [ ] Real prices in *Productos*, and a check that `disponible` is right.
- [ ] Config filled in: `metodos_pago`, `datos_pago`, `domicilio_valor`, `domicilio_gratis_desde`, `zonas_domicilio`, `zonas_sin_cobertura`, `horario_festivos`, `numero_respaldo`, `politica_*`, `contacto_datos_personales`.
- [ ] Privacy policy reviewed by a lawyer and published (`site/privacidad.html`, placeholders filled).
- [ ] Worker numbers in *Trabajadores*. Each worker writes *hola* once, and the `aviso_pedido` template is approved.
- [ ] Triggers installed (menu → *Activar tareas automáticas*): 5-minute tasks and the daily health check.
- [ ] Relay deployed with the queue on, and `/health` added to an uptime monitor.
- [ ] Provider-side spend cap set if Anthropic is used (Console → Limits → ~US$15/month).
- [ ] UAT done in Telegram with the owner and 5–10 friendly customers (`npm run telegram`).

## Week 1: `sombra`
- Workers approve or discard drafts. Every discarded draft gets a line in `SinResolver`, or a note to the developer.
- Daily: read `SinResolver`, add aliases to *Productos*, add real failures to `scripts/build-nlu-set.py`, run `npm test`.
- Exit criteria: at least 90% of drafts approved unchanged over 3 days, and no price or product mistakes.

## Weeks 2–3: `asistido`
- The bot answers on its own. Orders still need ✅ Confirmar.
- Watch the evening summary: % resolved without AI, handoffs, "no entendidos", failed sends, AI cost.
- Exit criteria:
  - zero double orders;
  - zero wrong prices;
  - every handoff answered within 10 minutes during opening hours;
  - order confirmations delivered (no `aviso = fallido` left for more than 15 minutes).

## Then: `autonomo`
- Announce it to customers: *"Ahora puedes pedir por aquí 24/7 con nuestro asistente 🍅"* (as a status or a pinned post, not a broadcast).
- Keep `pedido_grande_desde` so large orders are still reviewed.

## Reviews
Day 3, day 7 and day 30 after each step:
- read 20 real conversations (Sheet *Clientes* + WhatsApp app);
- check the cost against docs/COST_MODEL.md;
- adjust the thresholds (`minutos_escalar_asesor`, `ia_llamadas_*`, `pedido_grande_desde`).

Write down each decision in DECISIONS.md.
