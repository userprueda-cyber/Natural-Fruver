// Evaluación de las capas 0–2 (sin IA) sobre tests/nlu/messy_messages.jsonl.
// Si una de estas metas baja, algo empeoró: corre `node scripts/nlu-report.js --fails`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { run } = require('../scripts/nlu-report');

test('the messy-message set has at least 300 labeled messages', () => {
  const lines = fs.readFileSync(path.join(__dirname, 'nlu', 'messy_messages.jsonl'), 'utf8').trim().split('\n');
  assert.ok(lines.length >= 300, lines.length + ' messages');
});

test('NLU without AI: ≥ 85 % resolved (target), ≥ 97 % intents, ≥ 95 % item extraction', () => {
  const { summary, fails } = run();
  const detail = fails.slice(0, 10).map((f) => f.row.text).join(' | ');
  assert.ok(summary.resueltos_sin_ia_pct >= 85, 'resolved without AI: ' + summary.resueltos_sin_ia_pct + '% ' + detail);
  assert.ok(summary.intencion_pct >= 97, 'intent accuracy: ' + summary.intencion_pct + '% ' + detail);
  assert.ok(summary.extraccion_items_pct >= 95, 'item extraction: ' + summary.extraccion_items_pct + '% ' + detail);
  assert.ok(summary.exactos_pct >= 97, 'exact: ' + summary.exactos_pct + '% ' + detail);
});
