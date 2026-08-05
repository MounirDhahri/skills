import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupHunksByFile } from './lib/build-snapshot-diff.mjs';
import { computeLineStats } from './lib/compute-line-stats.mjs';

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

function sumStats(statsList) {
  return statsList.reduce(
    (acc, s) => ({ added: acc.added + s.added, deleted: acc.deleted + s.deleted }),
    { added: 0, deleted: 0 },
  );
}

function buildFile(hunkFile) {
  return {
    path: hunkFile.path,
    oldPath: hunkFile.oldPath,
    status: hunkFile.status,
    diffText: hunkFile.diffText,
    stats: computeLineStats(hunkFile.diffText),
  };
}

function buildSnapshot(snapshot) {
  const files = groupHunksByFile(snapshot.hunks).map(buildFile);
  return {
    id: snapshot.id,
    title: snapshot.title,
    prose: snapshot.prose,
    fileCount: files.length,
    files,
    stats: sumStats(files.map((f) => f.stats)),
  };
}

function buildChapter(chapter) {
  const snapshots = chapter.snapshots.map(buildSnapshot);
  return {
    id: chapter.id,
    title: chapter.title,
    icon: chapter.icon ?? null,
    snapshots,
    stats: sumStats(snapshots.map((s) => s.stats)),
  };
}

export function renderTour(tourData) {
  if (!Array.isArray(tourData?.chapters) || tourData.chapters.length === 0) {
    throw new Error('tour data must contain at least one chapter');
  }
  for (const chapter of tourData.chapters) {
    if (!Array.isArray(chapter?.snapshots) || chapter.snapshots.length === 0) {
      throw new Error(`chapter "${chapter?.id ?? '(unknown)'}" must contain at least one snapshot`);
    }
    for (const snapshot of chapter.snapshots) {
      if (!Array.isArray(snapshot?.hunks) || snapshot.hunks.length === 0) {
        throw new Error(
          `snapshot "${snapshot?.id ?? '(unknown)'}" in chapter "${chapter?.id ?? '(unknown)'}" must contain at least one hunk`,
        );
      }
    }
  }

  const template = readAsset('tour.template.html');

  const chapters = tourData.chapters.map(buildChapter);
  const total = sumStats(chapters.map((c) => c.stats));

  const dataJson = escapeForInlineScript(
    JSON.stringify({ title: tourData.title, prUrl: tourData.prUrl, chapters, total }),
  );

  // NOTE: replacement values are passed via a function (`() => value`), not
  // as the second argument directly. Vendored, minified assets can contain
  // "$&", "$`", "$'" etc., which String.replace() treats as special
  // replacement patterns when given as a plain string, silently corrupting
  // the output. A replacer function disables that interpretation.
  //
  // NOTE: the __TITLE__/__PR_URL__ global replaces MUST run before the
  // asset/tour-data inlining steps below. Those later steps inline
  // arbitrary diff text (via dataJson) and vendored JS/CSS into the
  // document. If a PR's own diff happens to contain the literal substring
  // "__TITLE__" or "__PR_URL__" (e.g. a PR touching this skill's template),
  // running the global replace AFTER inlining would silently corrupt that
  // diff text. Replacing the placeholders first means they only ever match
  // the literal placeholder markers in the template itself.
  return template
    .replace(/__TITLE__/g, () => escapeHtml(tourData.title))
    .replace(/__PR_URL__/g, () => escapeHtml(tourData.prUrl))
    .replace('/*__DIFF2HTML_CSS__*/', () => readAsset('diff2html.min.css'))
    .replace('/*__HLJS_CSS_DARK__*/', () => readAsset('github-dark.min.css'))
    .replace('/*__HLJS_CSS_LIGHT__*/', () => readAsset('github-light.min.css'))
    .replace('/*__DIFF2HTML_JS__*/', () => readAsset('diff2html-ui-slim.min.js'))
    .replace('/*__HLJS_JS__*/', () => readAsset('highlight.min.js'))
    .replace('/*__APP_JS__*/', () => readAsset('app.js'))
    .replace('/*__TOUR_DATA__*/', () => `window.__TOUR_DATA__ = ${dataJson};`);
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
