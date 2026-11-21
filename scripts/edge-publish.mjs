// Uploads a release zip to Microsoft Edge Add-ons and submits it for certification (API v1.1).
// Usage: node scripts/edge-publish.mjs prowl-v1.2.0.zip
// Env: EDGE_API_KEY (secret), EDGE_CLIENT_ID and EDGE_PRODUCT_ID, from Partner Center's
// "Publish API" page. In CI, .github/workflows/edge-add-ons.yml provides all three.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const API = 'https://api.addons.microsoftedge.microsoft.com';
/** Certification uploads are processed in minutes; give up after 5. */
const POLLS = 30;
const POLL_MS = 10_000;

/**
 * Uploads `zip` as the product's draft package, then submits the draft. Resolves to the operation
 * id of the submission and throws with Partner Center's answer when a step fails.
 */
export async function publishToEdge({
  zip,
  apiKey,
  clientId,
  productId,
  notes = '',
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  log = console.log,
}) {
  const product = `${API}/v1/products/${productId}/submissions`;
  const headers = { Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId };
  const call = async (method, url, body, type) => {
    const response = await fetch(url, {
      method,
      headers: type ? { ...headers, 'Content-Type': type } : headers,
      body,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${url} answered ${response.status}: ${text}`);
    return { location: response.headers.get('location'), json: text ? JSON.parse(text) : {} };
  };
  /** Follows an asynchronous operation until it succeeded. */
  const settle = async (url, what) => {
    for (let poll = 0; ; poll++) {
      const { json } = await call('GET', url);
      if (json.status === 'Succeeded') return;
      if (json.status !== 'InProgress')
        throw new Error(
          `${what} ${json.status ?? 'failed'}: ${json.message ?? ''} ${JSON.stringify(json.errors ?? [])}`,
        );
      if (poll === POLLS) throw new Error(`${what} was still in progress after 5 minutes.`);
      await sleep(POLL_MS);
    }
  };

  const upload = await call(
    'POST',
    `${product}/draft/package`,
    await readFile(zip),
    'application/zip',
  );
  await settle(`${product}/draft/package/operations/${upload.location}`, 'The upload');
  log(`Uploaded ${zip}.`);
  const submitted = await call('POST', product, JSON.stringify({ notes }), 'application/json');
  await settle(`${product}/operations/${submitted.location}`, 'The submission');
  log('Submitted for certification.');
  return submitted.location;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {
    EDGE_API_KEY: apiKey,
    EDGE_CLIENT_ID: clientId,
    EDGE_PRODUCT_ID: productId,
  } = process.env;
  const zip = process.argv[2];
  if (!zip || !apiKey || !clientId || !productId) {
    console.error(
      'Usage: EDGE_API_KEY=... EDGE_CLIENT_ID=... EDGE_PRODUCT_ID=... node scripts/edge-publish.mjs <zip>',
    );
    process.exit(1);
  }
  try {
    await publishToEdge({ zip, apiKey, clientId, productId, notes: `Prowl ${zip}` });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
