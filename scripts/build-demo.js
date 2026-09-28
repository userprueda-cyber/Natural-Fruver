// Genera site/data/demo-catalogo.json a partir de los datos de ejemplo de
// apps-script/Setup.gs, usando la misma lógica del catálogo real.
// Uso: npm run demo
const fs = require('fs');
const path = require('path');
const { createEnv } = require('../tests/gas-mock');

const env = createEnv();
const log = console.log;
console.log = () => {}; // setup() imprime instrucciones y un PIN de ejemplo
env.gs.setup();
console.log = log;
const catalog = JSON.parse(JSON.stringify(env.gs.buildCatalog_()));
catalog.generado = 'demo';
catalog.config.whatsapp = '';
// Ofertas de ejemplo sin fecha de vencimiento, para que el demo no "caduque".
catalog.productos.forEach((p) => { p.oferta_hasta = ''; });

const out = path.join(__dirname, '..', 'site', 'data', 'demo-catalogo.json');
fs.writeFileSync(out, JSON.stringify(catalog, null, 2) + '\n');
console.log('Escrito ' + path.relative(process.cwd(), out) + ' (' + catalog.productos.length + ' productos)');
