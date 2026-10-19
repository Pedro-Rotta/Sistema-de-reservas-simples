// Gera um único arquivo .html com CSS, JS e imagens embutidos, para enviar a alguém.
// Uso: node scripts/gerar-html-unico.js   →   dist/landing.html
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web');
const SAIDA = path.join(__dirname, '..', 'dist', 'landing.html');
const ler = (arq) => fs.readFileSync(path.join(WEB, arq), 'utf8');

let html = ler('index.html');

// CSS locais → <style>
html = html.replace(/<link rel="stylesheet" href="([^":]+\.css)">/g, (_, arq) => `<style>\n${ler(arq)}\n</style>`);

// JS local → <script> inline
html = html.replace(/<script src="([^":]+\.js)"><\/script>/g, (_, arq) => `<script>\n${ler(arq)}\n</script>`);

// Imagens locais → data URI
const tipos = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };
html = html.replace(/src="(img\/[^"]+)"/g, (orig, arq) => {
  const caminho = path.join(WEB, arq);
  if (!fs.existsSync(caminho)) return orig;
  const tipo = tipos[path.extname(arq).toLowerCase()] || 'application/octet-stream';
  return `src="data:${tipo};base64,${fs.readFileSync(caminho).toString('base64')}"`;
});

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, html);
console.log(`Gerado: ${path.relative(process.cwd(), SAIDA)} (${Math.round(fs.statSync(SAIDA).size / 1024)} KB)`);
