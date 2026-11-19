#!/usr/bin/env node
/**
 * Production bundle gate (run after `npm run build`):
 *  1. Initial JS = the entry script + every <link rel="modulepreload"> in dist/index.html,
 *     gzip-compressed, must be ≤ 200 KB (the brief's budget). Lazy route chunks don't count.
 *  2. No mock code may reach production: fails if any file in dist/ mentions MSW.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = join(import.meta.dirname, '..', 'dist');
const BUDGET_KB = 200;

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const initial = [
  ...html.matchAll(/<script[^>]+type="module"[^>]+src="\/?([^"]+)"/g),
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/?([^"]+)"/g),
].map((m) => m[1]);

let total = 0;
for (const file of new Set(initial)) {
  const size = gzipSync(readFileSync(join(DIST, file))).length;
  total += size;
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${file}`);
}
console.log(
  `${(total / 1024).toFixed(1).padStart(7)} KB  initial JS (gzip), budget ${BUDGET_KB} KB`,
);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const leaks = walk(DIST).filter(
  (file) =>
    /\.(js|html)$/.test(file) &&
    /mockServiceWorker|msw\/browser|setupWorker/.test(readFileSync(file, 'utf8')),
);

let failed = false;
if (total > BUDGET_KB * 1024) {
  console.error(`✗ initial JS ${(total / 1024).toFixed(1)} KB exceeds ${BUDGET_KB} KB`);
  failed = true;
}
if (leaks.length > 0) {
  console.error(`✗ mock code found in production build:\n  ${leaks.join('\n  ')}`);
  failed = true;
}
if (failed) process.exit(1);
console.log('✓ bundle within budget, no mock code');
