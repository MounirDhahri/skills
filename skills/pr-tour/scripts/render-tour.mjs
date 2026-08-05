import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshotDiffText } from './lib/build-snapshot-diff.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = resolve(__dirname, '../assets');

function readAsset(name) {
  return readFileSync(resolve(ASSETS_DIR, name), 'utf8');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeForInlineScript(json) {
  return json.replace(/</g, '\\u003c');
}

export function renderTour(tourData) {
  const template = readAsset('tour.template.html');

  const snapshots = tourData.snapshots.map((s) => ({
    id: s.id,
    title: s.title,
    prose: s.prose,
    diffText: buildSnapshotDiffText(s),
  }));

  const dataJson = escapeForInlineScript(
    JSON.stringify({ title: tourData.title, prUrl: tourData.prUrl, snapshots }),
  );

  // NOTE: replacement values are passed via a function (`() => value`), not
  // as the second argument directly. Vendored, minified assets can contain
  // "$&", "$`", "$'" etc., which String.replace() treats as special
  // replacement patterns when given as a plain string, silently corrupting
  // the output. A replacer function disables that interpretation.
  return template
    .replace('/*__DIFF2HTML_CSS__*/', () => readAsset('diff2html.min.css'))
    .replace('/*__HLJS_CSS__*/', () => readAsset('github-dark.min.css'))
    .replace('/*__DIFF2HTML_JS__*/', () => readAsset('diff2html-ui-slim.min.js'))
    .replace('/*__HLJS_JS__*/', () => readAsset('highlight.min.js'))
    .replace('/*__APP_JS__*/', () => readAsset('app.js'))
    .replace('/*__TOUR_DATA__*/', () => `window.__TOUR_DATA__ = ${dataJson};`)
    .replace(/__TITLE__/g, () => escapeHtml(tourData.title))
    .replace(/__PR_URL__/g, () => escapeHtml(tourData.prUrl));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--data') args.data = argv[i + 1];
    if (argv[i] === '--out') args.out = argv[i + 1];
  }
  if (!args.data || !args.out) {
    throw new Error('Usage: render-tour.mjs --data <tour.json> --out <output.html>');
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tourData = JSON.parse(readFileSync(resolve(args.data), 'utf8'));
  const html = renderTour(tourData);
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  console.log(`Wrote tour to ${outPath}`);
}

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  main();
}
