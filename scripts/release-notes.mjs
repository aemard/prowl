// Prints the CHANGELOG.md section for a tag (e.g. v1.0.0) to stdout.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tag = process.argv[2];
if (!tag) {
  console.error('Usage: node scripts/release-notes.mjs <tag>');
  process.exit(1);
}
const version = tag.replace(/^v/, '');
const changelog = readFileSync(resolve(import.meta.dirname, '../CHANGELOG.md'), 'utf8');
const lines = changelog.split('\n');
const start = lines.findIndex((l) => /^##\s/.test(l) && l.includes(version));
if (start === -1) {
  console.log(`Release ${tag}. See CHANGELOG.md.`);
  process.exit(0);
}
const rest = lines.slice(start + 1);
const end = rest.findIndex((l) => /^##\s/.test(l));
console.log((end === -1 ? rest : rest.slice(0, end)).join('\n').trim());
