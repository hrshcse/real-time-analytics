#!/usr/bin/env node
/**
 * Performance gate (WBS 21.2): fails if any built bundle exceeds its gzip budget, or if
 * dev-only code leaked into the production build. Run after `npm run build`.
 *
 *   node scripts/check-bundle-size.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// fileURLToPath, not URL.pathname: on Windows .pathname gives '/H:/…', which breaks path.join.
const root = fileURLToPath(new URL('..', import.meta.url));
const budget = JSON.parse(readFileSync(join(root, 'perf-budget.json'), 'utf8'));
const assets = join(root, 'apps/web/dist/assets');

let files;
try {
  files = readdirSync(assets);
} catch {
  console.error('apps/web/dist/assets not found — run `npm run build` first.');
  process.exit(1);
}

const kb = (n) => Math.round((n / 1024) * 10) / 10;
const rows = [];
let failed = false;
let total = 0;

for (const b of budget.bundles) {
  const re = new RegExp(b.pattern);
  const matched = files.filter((f) => re.test(f));
  if (matched.length === 0) {
    rows.push({
      bundle: b.name,
      files: '(none)',
      gzipKB: 0,
      budgetKB: b.maxGzipKB,
      result: 'FAIL: missing',
    });
    failed = true;
    continue;
  }
  const size = matched.reduce(
    (s, f) => s + gzipSync(readFileSync(join(assets, f)), { level: 9 }).length,
    0,
  );
  total += size;
  const ok = kb(size) <= b.maxGzipKB;
  if (!ok) failed = true;
  rows.push({
    bundle: b.name,
    files: matched.join(', '),
    gzipKB: kb(size),
    budgetKB: b.maxGzipKB,
    result: ok ? 'ok' : 'FAIL',
  });
}

const totalOk = kb(total) <= budget.totalMaxGzipKB;
if (!totalOk) failed = true;
rows.push({
  bundle: 'TOTAL',
  files: '',
  gzipKB: kb(total),
  budgetKB: budget.totalMaxGzipKB,
  result: totalOk ? 'ok' : 'FAIL',
});
console.table(rows);

for (const f of budget.forbiddenStrings ?? []) {
  const hits = files.filter(
    (file) =>
      /\.(js|css|html)$/.test(file) && readFileSync(join(assets, file), 'utf8').includes(f.text),
  );
  if (hits.length) {
    console.error(`FAIL: "${f.text}" found in ${hits.join(', ')} — ${f.reason}`);
    failed = true;
  }
}

if (failed) {
  console.error(
    '\nPerformance budget exceeded. If the increase is intended, raise the budget in perf-budget.json and record why in docs/PERFORMANCE.md.',
  );
  process.exit(1);
}
console.log('Bundle budgets OK.');
