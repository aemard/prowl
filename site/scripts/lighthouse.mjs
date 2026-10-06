// Serves the built site (site/dist) like GitHub Pages does and runs Lighthouse on every page.
// Exits 1 when a page scores below 95 in performance, accessibility, best practices or SEO.
//
//   pnpm --filter site lighthouse
//
// Chrome comes from CHROME_PATH (chrome-launcher also looks for an installed Chrome). Lighthouse
// is run with its defaults: mobile emulation and simulated slow 4G, the strictest profile.
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const MIN_SCORE = 95;
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const BASE = '/prowl/';
const dist = resolve(import.meta.dirname, '../dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = /^(text\/|image\/svg|application\/xml)/;

/** Every `index.html` under dist as a path under BASE: `/prowl/`, `/prowl/auth/`, ... */
function pagePaths(dir = dist, prefix = BASE) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return pagePaths(join(dir, entry.name), `${prefix}${entry.name}/`);
    return entry.name === 'index.html' ? [prefix] : [];
  });
}

/** What GitHub Pages does: files under BASE, gzip for text and a ten minute cache. */
function serve(request, response) {
  // Outside BASE (Lighthouse asks for /robots.txt) the project site has nothing: 404.
  let path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(dist, `.${path.slice(BASE.length - 1)}`);
  let body;
  try {
    if (!path.startsWith(BASE) || !file.startsWith(`${dist}/`)) throw new Error('not served');
    body = readFileSync(file);
  } catch {
    response.writeHead(404, { 'content-type': TYPES['.txt'] }).end('Not found');
    return;
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const headers = { 'content-type': type, 'cache-control': 'max-age=600' };
  if (COMPRESSIBLE.test(type)) {
    body = gzipSync(body);
    headers['content-encoding'] = 'gzip';
  }
  response.writeHead(200, headers).end(body);
}

const server = createServer(serve);
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = await launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });

const failures = [];
try {
  for (const path of pagePaths().sort()) {
    const result = await lighthouse(`${origin}${path}`, {
      port: chrome.port,
      logLevel: 'error',
      onlyCategories: CATEGORIES,
    });
    const scores = Object.fromEntries(
      CATEGORIES.map((id) => [id, Math.round((result?.lhr.categories[id].score ?? 0) * 100)]),
    );
    const failed = CATEGORIES.filter((id) => scores[id] < MIN_SCORE);
    console.log(
      `${failed.length ? 'FAIL' : 'ok  '} ${path.padEnd(24)}`,
      CATEGORIES.map((id) => `${id} ${scores[id]}`).join('  '),
    );
    for (const id of failed) {
      const audits = result.lhr.categories[id].auditRefs
        .map(({ id: auditId }) => result.lhr.audits[auditId])
        .filter(
          (audit) =>
            audit.score !== null && audit.score < 1 && audit.scoreDisplayMode !== 'informative',
        );
      for (const audit of audits) console.log(`       ${id}: ${audit.title} (${audit.score})`);
      failures.push(`${path} ${id} ${scores[id]}`);
    }
  }
} finally {
  chrome.kill();
  server.close();
}

if (failures.length) {
  console.error(`\nBelow ${MIN_SCORE}:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`\nEvery page scores ${MIN_SCORE} or more in ${CATEGORIES.join(', ')}.`);
