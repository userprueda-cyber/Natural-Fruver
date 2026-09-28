// Evalúa las capas 0–2 (sin IA) contra tests/nlu/messy_messages.jsonl.
//   node scripts/nlu-report.js          → resumen
//   node scripts/nlu-report.js --fails  → también los mensajes que fallan
const fs = require('fs');
const path = require('path');
const { createEnv } = require('../tests/gas-mock');

const ORDERISH = ['order', 'unknown'];

function loadBot() {
  const env = createEnv();
  const log = console.log;
  console.log = () => {};
  env.gs.setup();
  console.log = log;
  return env.gs;
}

function evaluate(g, text, index, units) {
  const norm = g.normText_(text);
  const intent = g.detectIntent_(norm, text);
  const out = { intent, items: {}, asks: [], missing: 0 };
  if (ORDERISH.includes(intent)) {
    const p = g.parseOrderText_(norm, index, units);
    p.items.forEach((it) => { out.items[it.id] = (out.items[it.id] || 0) + it.cantidad; });
    out.asks = p.asks.map((a) => a.kind).sort();
    out.missing = p.missing.filter((m) => m.raw).length;
  }
  return out;
}

function compare(exp, got) {
  const intentOk = exp.intent === got.intent || (ORDERISH.includes(exp.intent) && ORDERISH.includes(got.intent));
  const itemsOk = !ORDERISH.includes(exp.intent) ||
    (JSON.stringify(Object.entries(exp.items).sort()) === JSON.stringify(Object.entries(got.items).sort()) &&
      JSON.stringify([...exp.asks].sort()) === JSON.stringify(got.asks) && exp.missing === got.missing);
  const resolved = got.intent !== 'unknown' || Object.keys(got.items).length > 0 || got.asks.length > 0 || got.missing > 0;
  return { intentOk, itemsOk, ok: intentOk && itemsOk, resolved };
}

function run() {
  const g = loadBot();
  const index = g.productIndex_();
  const units = g.unitTable_();
  const rows = fs.readFileSync(path.join(__dirname, '..', 'tests', 'nlu', 'messy_messages.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const results = rows.map((r) => {
    const got = evaluate(g, r.text, index, units);
    return Object.assign({ row: r, got }, compare(r, got));
  });
  const n = results.length;
  const pct = (k) => Math.round(1000 * k / n) / 10;
  const orderRows = results.filter((x) => ORDERISH.includes(x.row.intent) && (Object.keys(x.row.items).length || x.row.asks.length || x.row.missing));
  const expectsSomething = results.filter((x) => !(x.row.intent === 'unknown' && !Object.keys(x.row.items).length && !x.row.asks.length && !x.row.missing));
  const summary = {
    mensajes: n,
    exactos_pct: pct(results.filter((x) => x.ok).length),
    intencion_pct: pct(results.filter((x) => x.intentOk).length),
    extraccion_items_pct: Math.round(1000 * orderRows.filter((x) => x.itemsOk).length / orderRows.length) / 10,
    resueltos_sin_ia_pct: Math.round(1000 * expectsSomething.filter((x) => x.ok && x.resolved).length / expectsSomething.length) / 10,
    por_variante: {}
  };
  const variants = [...new Set(rows.map((r) => r.variant))];
  variants.forEach((v) => {
    const sub = results.filter((x) => x.row.variant === v);
    summary.por_variante[v] = Math.round(1000 * sub.filter((x) => x.ok).length / sub.length) / 10 + '% de ' + sub.length;
  });
  return { summary, fails: results.filter((x) => !x.ok) };
}

if (require.main === module) {
  const { summary, fails } = run();
  console.log(JSON.stringify(summary, null, 2));
  if (process.argv.includes('--fails')) {
    fails.forEach((f) => console.log('✖', JSON.stringify(f.row.text), '\n   esperado', JSON.stringify({ i: f.row.intent, it: f.row.items, a: f.row.asks, m: f.row.missing }), '\n   obtenido', JSON.stringify({ i: f.got.intent, it: f.got.items, a: f.got.asks, m: f.got.missing })));
  }
}

module.exports = { run };
