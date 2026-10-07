import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { publishToStore } from './cws-publish.mjs';

const ITEM = 'https://chromewebstore.googleapis.com/v2/publishers/pub/items/abc';
const UPLOAD = 'https://chromewebstore.googleapis.com/upload/v2/publishers/pub/items/abc:upload';

const zip = join(mkdtempSync(join(tmpdir(), 'cws-')), 'prowl-v1.2.0.zip');
writeFileSync(zip, 'PK zip bytes');

/** A fake fetch that answers each call with the next reply and records the requests. */
function fakeStore(...replies) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, method: init.method, auth: init.headers.Authorization, body: init.body });
    const { status = 200, json } = replies.shift() ?? {
      status: 500,
      json: { error: 'unexpected' },
    };
    return new Response(JSON.stringify(json), { status });
  };
  return { fetch, requests };
}

const run = (store, logs = []) =>
  publishToStore({
    zip,
    token: 'ya29.token',
    publisherId: 'pub',
    itemId: 'abc',
    fetch: store.fetch,
    sleep: async () => {},
    log: (line) => logs.push(line),
  });

describe('publishToStore', () => {
  it('uploads the zip, submits it and reports the new state', async () => {
    const store = fakeStore(
      { json: { uploadState: 'SUCCEEDED', crxVersion: '1.2.0' } },
      { json: { state: 'PENDING_REVIEW' } },
    );
    const logs = [];
    await expect(run(store, logs)).resolves.toBe('PENDING_REVIEW');
    expect(store.requests.map(({ url, method }) => [method, url])).toEqual([
      ['POST', UPLOAD],
      ['POST', `${ITEM}:publish`],
    ]);
    expect(store.requests[0].auth).toBe('Bearer ya29.token');
    expect(Buffer.from(store.requests[0].body).toString()).toBe('PK zip bytes');
    expect(logs).toEqual([
      `Uploaded ${zip} (version 1.2.0).`,
      'Submitted: the item is PENDING_REVIEW.',
    ]);
  });

  it('waits for an upload that is still being processed', async () => {
    const store = fakeStore(
      { json: { uploadState: 'IN_PROGRESS' } },
      { json: { lastAsyncUploadState: 'IN_PROGRESS' } },
      { json: { lastAsyncUploadState: 'SUCCEEDED' } },
      { json: { state: 'PENDING_REVIEW' } },
    );
    await expect(run(store)).resolves.toBe('PENDING_REVIEW');
    expect(store.requests.map(({ url }) => url)).toEqual([
      UPLOAD,
      `${ITEM}:fetchStatus`,
      `${ITEM}:fetchStatus`,
      `${ITEM}:publish`,
    ]);
  });

  it('stops when the upload fails or never settles, without submitting', async () => {
    const failed = fakeStore(
      { json: { uploadState: 'IN_PROGRESS' } },
      { json: { lastAsyncUploadState: 'FAILED' } },
    );
    await expect(run(failed)).rejects.toThrow('The upload ended in state FAILED.');
    expect(failed.requests.some(({ url }) => url.endsWith(':publish'))).toBe(false);

    const stuck = fakeStore(
      { json: { uploadState: 'IN_PROGRESS' } },
      ...Array.from({ length: 30 }, () => ({ json: { lastAsyncUploadState: 'IN_PROGRESS' } })),
    );
    await expect(run(stuck)).rejects.toThrow('still being processed after 5 minutes');
  });

  it('passes on what the store answered when a request is refused', async () => {
    const store = fakeStore({
      status: 400,
      json: { error: { message: 'Version must be higher' } },
    });
    await expect(run(store)).rejects.toThrow(
      `POST ${UPLOAD} answered 400: {"error":{"message":"Version must be higher"}}`,
    );
  });

  it('logs the warnings the store attaches to a submission', async () => {
    const store = fakeStore(
      { json: { uploadState: 'SUCCEEDED' } },
      {
        json: {
          state: 'PENDING_REVIEW',
          warningInfo: { warnings: [{ reason: 'PERMISSIONS', description: 'Broad host access' }] },
        },
      },
    );
    const logs = [];
    await run(store, logs);
    expect(logs).toEqual([
      `Uploaded ${zip}.`,
      'Warning: PERMISSIONS: Broad host access',
      'Submitted: the item is PENDING_REVIEW.',
    ]);
  });
});
