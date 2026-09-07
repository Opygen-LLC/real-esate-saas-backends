import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'PHASE1_PATCH_MANIFEST.json'), 'utf8'));
const before = process.argv.includes('--before');
const targetIndex = process.argv.indexOf('--target');
if (targetIndex >= 0 && !process.argv[targetIndex + 1]) throw new Error('--target requires a project directory');
const target = targetIndex >= 0 ? resolve(process.argv[targetIndex + 1]) : root;
const hash = path => existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
let problems = 0;
for (const entry of [...manifest.files, ...manifest.deletions]) {
  const path = resolve(target, entry.path); const rel = relative(target, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unsafe manifest path');
  const actual = hash(path);
  const valid = before ? (actual === entry.originalSha256 || actual === entry.sha256) : actual === entry.sha256;
  if (!valid) { console.error(`${before ? 'Local conflict' : 'Patch mismatch'}: ${entry.path}`); problems++; }
}
if (problems) { console.error('Stop and merge the listed files manually. Do not overwrite unrelated work.'); process.exitCode = 1; }
else console.log(`${before ? 'Baseline compatible' : 'Patch verified'}: ${manifest.files.length} changed/new files, ${manifest.deletions.length} deletions. This verifies bytes, not application behavior.`);
