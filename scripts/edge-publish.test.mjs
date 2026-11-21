import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { publishToEdge } from './edge-publish.mjs';

const BASE = 'https://api.addons.microsoftedge.microsoft.com/v1/products/prod/submissions';
const zip = join(mkdtempSync(join(tmpdir(), 'edge-')), 'prowl-v1.2.0.zip');
writeFileSync(zip, 'PK zip bytes');

/** Answers each call with the next reply (`status`, `json`, `location`) and records requests. */
function fakeCenter(...replies) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, method: init.method, headers: init.headers });
    const { status = 200, json, location } = replies.shift() ?? { status: 500, json: {} };
    return new Response(json === undefined ? '' : JSON.stringify(json), {
      status,
      headers: location ? { location } : {},
    });
  };
  return { fetch, requests };
}

const run = (center) =>
  publishToEdge({
    zip,
    apiKey: 'key',
    clientId: 'client',
    productId: 'prod',
    fetch: center.fetch,
    sleep: async () => {},
    log: () => {},
  });

describe('publishToEdge', () => {
  it('uploads the draft package, waits for it, then submits it', async () => {
    const center = fakeCenter(
      { status: 202, location: 'op-1' },
      { json: { status: 'InProgress' } },
      { json: { status: 'Succeeded' } },
      { status: 202, location: 'op-2' },
      { json: { status: 'Succeeded' } },
    );
    await expect(run(center)).resolves.toBe('op-2');
    expect(center.requests.map(({ method, url }) => [method, url])).toEqual([
      ['POST', `${BASE}/draft/package`],
      ['GET', `${BASE}/draft/package/operations/op-1`],
      ['GET', `${BASE}/draft/package/operations/op-1`],
      ['POST', BASE],
      ['GET', `${BASE}/operations/op-2`],
    ]);
    expect(center.requests[0].headers).toEqual({
      Authorization: 'ApiKey key',
      'X-ClientID': 'client',
      'Content-Type': 'application/zip',
    });
  });

  it('reports a failed upload and an HTTP error', async () => {
    const failed = fakeCenter(
      { status: 202, location: 'op' },
      { json: { status: 'Failed', message: 'Bad manifest', errors: [{ message: 'x' }] } },
    );
    await expect(run(failed)).rejects.toThrow('The upload Failed: Bad manifest');
    await expect(run(fakeCenter({ status: 401, json: { message: 'no' } }))).rejects.toThrow(
      'answered 401',
    );
  });
});
