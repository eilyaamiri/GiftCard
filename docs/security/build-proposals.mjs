// Builds docs/security/proposals.html from the per-area JSON files in ./data.
// Usage: node docs/security/build-proposals.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const order = ['payments', 'orders', 'fulfillment', 'identity', 'fx', 'worker', 'web', 'platform'];
const files = readdirSync(join(here, 'data'))
  .filter((f) => f.endsWith('.json'))
  .sort((a, b) => order.indexOf(a.replace('.json', '')) - order.indexOf(b.replace('.json', '')));

const data = { generated: new Date().toISOString().slice(0, 10), proposals: [], fixes: [], frozen: [] };
const seen = new Set();
for (const f of files) {
  const part = JSON.parse(readFileSync(join(here, 'data', f), 'utf8'));
  for (const key of ['proposals', 'fixes', 'frozen']) {
    for (const item of part[key] ?? []) {
      if (seen.has(item.id)) throw new Error(`duplicate id ${item.id} in ${f}`);
      seen.add(item.id);
      data[key].push(item);
    }
  }
}

// `</` inside the inline script would end it early; escape `<` the same way the web app does.
const json = JSON.stringify(data)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');
const template = readFileSync(join(here, 'proposals-template.html'), 'utf8');
const marker = '/*__DATA__*/{"generated":"","proposals":[],"fixes":[],"frozen":[]}';
if (!template.includes(marker)) throw new Error('data marker missing from template');
writeFileSync(join(here, 'proposals.html'), template.replace(marker, () => json));
console.log(`proposals=${data.proposals.length} fixes=${data.fixes.length} frozen=${data.frozen.length}`);
