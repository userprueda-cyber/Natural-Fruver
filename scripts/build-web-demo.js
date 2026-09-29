// Empaqueta apps-script/*.gs en site/js/demo-gs.js para que la demo web corra el código REAL del bot.
//   npm run web-demo        → regenera el archivo (hazlo después de cambiar cualquier .gs)
// tests/webdemo.test.js falla si el archivo quedó desactualizado.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'apps-script');
const OUT = path.join(__dirname, '..', 'site', 'js', 'demo-gs.js');

function build() {
  const sources = fs.readdirSync(DIR).filter((f) => f.endsWith('.gs')).sort().map((f) => fs.readFileSync(path.join(DIR, f), 'utf8'));
  return '// GENERADO por scripts/build-web-demo.js (npm run web-demo). No editar a mano.\n' +
    'var NF_GS_SOURCES = ' + JSON.stringify(sources) + ';\n' +
    'if (typeof module !== "undefined") module.exports = NF_GS_SOURCES;\n';
}

if (require.main === module) {
  fs.writeFileSync(OUT, build());
  console.log('Escrito ' + path.relative(process.cwd(), OUT) + ' (' + Math.round(fs.statSync(OUT).size / 1024) + ' KB)');
}

module.exports = { build, OUT };
