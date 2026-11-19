#!/usr/bin/env node
/**
 * Enforces "no hardcoded colours or spacing outside the token files".
 * In every CSS file except src/styles/{tokens,typography}.css it rejects:
 *   - hex colours, rgb()/hsl()/oklch() colour functions, named colours other than
 *     transparent/currentColor/inherit;
 *   - px/rem/em lengths other than 0, 1px and 2px (hairlines), except inside @media queries.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'src');
const ALLOWED_FILES = new Set(['styles/tokens.css', 'styles/typography.css']);
const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|lab|lch)\(/;
const NAMED = /:\s*[^;]*\b(?:white|black|red|blue|green|yellow|gray|grey|orange|purple)\b/i;
const LENGTH = /(?<![\w-])(\d*\.?\d+)(px|rem|em)\b/g;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.css') ? [path] : [];
  });
}

const problems = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (ALLOWED_FILES.has(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  let inComment = false;
  lines.forEach((raw, index) => {
    let line = raw;
    if (inComment) {
      const end = line.indexOf('*/');
      if (end === -1) return;
      line = line.slice(end + 2);
      inComment = false;
    }
    line = line.replace(/\/\*.*?\*\//g, '');
    const start = line.indexOf('/*');
    if (start !== -1) {
      line = line.slice(0, start);
      inComment = true;
    }
    if (line.trim().startsWith('@media') || line.trim().startsWith('@container')) return;
    const where = `src/${rel}:${index + 1}`;
    if (COLOR.test(line)) problems.push(`${where}  hardcoded colour: ${raw.trim()}`);
    if (NAMED.test(line) && !line.includes('var('))
      problems.push(`${where}  named colour: ${raw.trim()}`);
    for (const match of line.matchAll(LENGTH)) {
      const value = Number(match[1]);
      const unit = match[2];
      if (value === 0) continue;
      if (unit === 'px' && (value === 1 || value === 2)) continue;
      problems.push(`${where}  hardcoded length ${match[0]} (use a token): ${raw.trim()}`);
    }
  });
}

if (problems.length > 0) {
  console.error(`CSS token check failed (${problems.length}):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('CSS token check passed.');
