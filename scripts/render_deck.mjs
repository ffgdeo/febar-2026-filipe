import { readFile, writeFile } from 'node:fs/promises';
import { marked } from '../app/promoflow-cleany/node_modules/.pnpm/marked@17.0.3/node_modules/marked/lib/marked.esm.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/render_deck.mjs input.md output.html');
const markdown = await readFile(input, 'utf8');
const content = await marked.parse(markdown, { gfm: true });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 13.333in 7.5in; margin: 0.55in 0.7in; }
* { box-sizing: border-box; } body { margin: 0; color: #1b3139; font: 20px/1.35 Arial, sans-serif; }
h1 { color: #1b3139; font-size: 34px; margin: 0 0 18px; } h2 { color: #5d6d74; font-size: 24px; }
h1:not(:first-child) { break-before: page; } hr { display: none; }
table { border-collapse: collapse; width: 100%; font-size: 15px; } th { background: #1b3139; color: white; }
th, td { border: 1px solid #c8d1d5; padding: 8px; text-align: left; vertical-align: top; }
tr:nth-child(even) { background: #f4f7f8; } code, pre { font: 15px Menlo, monospace; }
strong { color: #0b776d; } li { margin: 7px 0; } a { color: #d62b17; }
</style></head><body>${content}</body></html>`;
await writeFile(output, html);
