// Uploads a release zip to the Chrome Web Store and submits it for review, with API v2.
// Usage: node scripts/cws-publish.mjs prowl-v1.2.0.zip
// Env: CWS_ACCESS_TOKEN (an OAuth token with the chromewebstore scope), CWS_PUBLISHER_ID and
// CWS_ITEM_ID. In CI, .github/workflows/chrome-web-store.yml provides all three.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const API = 'https://chromewebstore.googleapis.com';
/** Processing a package rarely takes long; give up after 5 minutes. */
const POLLS = 30;
const POLL_MS = 10_000;

/**
 * Uploads `zip` to the item and submits it for review. Resolves to the item state the store
 * reports (normally PENDING_REVIEW) and throws with the store's answer when a step fails.
 */
export async function publishToStore({
  zip,
  token,
  publisherId,
  itemId,
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  log = console.log,
}) {
  const item = `publishers/${publisherId}/items/${itemId}`;
  const call = async (method, url, body) => {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${url} answered ${response.status}: ${text}`);
    return text ? JSON.parse(text) : {};
  };

  const upload = await call('POST', `${API}/upload/v2/${item}:upload`, await readFile(zip));
  let state = upload.uploadState;
  // Large packages are processed asynchronously: poll until the upload settles.
  for (let poll = 0; state?.includes('IN_PROGRESS'); poll++) {
    if (poll === POLLS) throw new Error('The upload was still being processed after 5 minutes.');
    await sleep(POLL_MS);
    state = (await call('GET', `${API}/v2/${item}:fetchStatus`)).lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') throw new Error(`The upload ended in state ${state}.`);
  log(`Uploaded ${zip}${upload.crxVersion ? ` (version ${upload.crxVersion})` : ''}.`);

  const published = await call('POST', `${API}/v2/${item}:publish`);
  for (const { reason, description } of published.warningInfo?.warnings ?? []) {
    log(`Warning: ${reason}: ${description}`);
  }
  log(`Submitted: the item is ${published.state}.`);
  return published.state;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {
    CWS_ACCESS_TOKEN: token,
    CWS_PUBLISHER_ID: publisherId,
    CWS_ITEM_ID: itemId,
  } = process.env;
  const zip = process.argv[2];
  if (!zip || !token || !publisherId || !itemId) {
    console.error(
      'Usage: CWS_ACCESS_TOKEN=... CWS_PUBLISHER_ID=... CWS_ITEM_ID=... node scripts/cws-publish.mjs <zip>',
    );
    process.exit(1);
  }
  try {
    await publishToStore({ zip, token, publisherId, itemId });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
