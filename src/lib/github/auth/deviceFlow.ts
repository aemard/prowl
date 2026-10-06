/**
 * GitHub's OAuth device flow (RFC 8628): the panel shows a one-time code, the user enters it on
 * github.com, and Prowl polls until GitHub hands over a token. No client secret is involved, so
 * the OAuth App's client id is public. The endpoints live on `env.webUrl` (github.com), not on
 * the API host. Everything that fails throws a `DeviceFlowError` whose message can be shown as
 * is; a cancelled flow rejects with the `AbortSignal`'s reason instead.
 */
import { env } from '../../env';
import type { FetchLike } from '../client';
import { type PatValidation, validatePat } from './pat';

/** What Prowl asks for: `repo` reads private repositories and lets it approve and merge. */
export const DEVICE_SCOPE = 'repo';

/** Where the auth docs live; opened from builds that cannot offer the device flow. */
export const AUTH_DOCS_URL = `${env.webUrl}/aemard/prowl/blob/main/docs/auth.md`;

const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const TIMEOUT_MS = 20_000;
const DEFAULT_INTERVAL_SECONDS = 5;
/** RFC 8628: after `slow_down`, wait 5 seconds longer between polls. */
const SLOW_DOWN_SECONDS = 5;

export type DeviceFlowFailure = 'expired' | 'denied' | 'unsupported' | 'network' | 'server';

const MESSAGES: Record<DeviceFlowFailure, string> = {
  expired: 'The code expired before it was used. Start again to get a new one.',
  denied: 'Access was denied on GitHub. Start again to authorize Prowl, or paste a token instead.',
  unsupported:
    'Signing in from the browser is not available for this build of Prowl. Paste a token instead.',
  network: 'Could not reach GitHub. Check your connection and try again.',
  server: 'GitHub is having trouble right now. Try again in a moment.',
};

export class DeviceFlowError extends Error {
  override readonly name = 'DeviceFlowError';
  readonly reason: DeviceFlowFailure;

  constructor(reason: DeviceFlowFailure) {
    super(MESSAGES[reason]);
    this.reason = reason;
  }
}

export interface DeviceFlowOptions {
  /** Defaults to the build's OAuth App client id. */
  clientId?: string;
  /** Where the device endpoints live; defaults to `env.webUrl`. */
  webUrl?: string;
  fetch?: FetchLike;
  /** Aborting rejects whatever is in flight with `signal.reason`. */
  signal?: AbortSignal;
}

export interface DeviceCode {
  /** Secret half, only ever sent back to GitHub. */
  deviceCode: string;
  /** What the user types on GitHub, e.g. `WDJB-MJHT`. */
  userCode: string;
  /** Where to type it. */
  verificationUri: string;
  /** Epoch ms after which GitHub refuses the code. */
  expiresAt: number;
  /** Seconds to wait between polls. */
  interval: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The device endpoints answer 200 with `{ error }` while the user has not decided yet. */
const KEEP_POLLING = new Set(['authorization_pending', 'slow_down']);

/** Errors that mean this build or its OAuth App cannot use the device flow at all. */
const UNSUPPORTED = new Set([
  'device_flow_disabled',
  'unauthorized_client',
  'incorrect_client_credentials',
  'unsupported_grant_type',
]);

function refusal(code: string, status: number): DeviceFlowError {
  if (code === 'expired_token') return new DeviceFlowError('expired');
  if (code === 'access_denied') return new DeviceFlowError('denied');
  // GitHub answers 404 for a client id it does not know (not verified against the live API).
  if (UNSUPPORTED.has(code) || status === 404) return new DeviceFlowError('unsupported');
  return new DeviceFlowError('server');
}

/** POSTs a form to a device endpoint; resolves to the JSON body unless GitHub refused. */
async function post(
  path: string,
  params: Record<string, string>,
  { webUrl = env.webUrl, fetch: fetchImpl, signal }: DeviceFlowOptions,
): Promise<Record<string, unknown>> {
  let response: Response;
  let payload: unknown;
  try {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    response = await (fetchImpl ?? ((input, init) => fetch(input, init)))(`${webUrl}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams(params),
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    payload = await response.json().catch(() => undefined);
  } catch {
    if (signal?.aborted) throw signal.reason;
    // The cause is dropped on purpose: whatever fetch threw may mention the request.
    throw new DeviceFlowError('network');
  }
  if (isRecord(payload) && typeof payload.error === 'string') {
    if (KEEP_POLLING.has(payload.error)) return payload;
    throw refusal(payload.error, response.status);
  }
  if (!response.ok || !isRecord(payload)) throw refusal('', response.status);
  return payload;
}

/** Starts the flow: asks GitHub for a device code and the user code to show. */
export async function requestDeviceCode(options: DeviceFlowOptions = {}): Promise<DeviceCode> {
  const { clientId = env.clientId } = options;
  if (clientId === '') throw new DeviceFlowError('unsupported');
  const payload = await post(
    '/login/device/code',
    { client_id: clientId, scope: DEVICE_SCOPE },
    options,
  );
  const { device_code, user_code, verification_uri, expires_in, interval } = payload;
  if (
    typeof device_code !== 'string' ||
    typeof user_code !== 'string' ||
    typeof verification_uri !== 'string' ||
    typeof expires_in !== 'number'
  ) {
    throw new DeviceFlowError('server');
  }
  return {
    deviceCode: device_code,
    userCode: user_code,
    verificationUri: verification_uri,
    expiresAt: Date.now() + expires_in * 1000,
    interval: typeof interval === 'number' && interval > 0 ? interval : DEFAULT_INTERVAL_SECONDS,
  };
}

/** `setTimeout` that settles with the signal's reason as soon as it aborts. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Polls until the user decides: resolves to the access token once they approve; throws
 * `expired` (the code ran out), `denied` (they refused) or `unsupported` (GitHub does not know
 * the client or has the device flow off). Waits `interval` before every request, 5 s longer
 * after each `slow_down`. A failed request ends the flow: the user can start again.
 */
export async function pollForToken(
  code: DeviceCode,
  options: DeviceFlowOptions = {},
): Promise<string> {
  const { clientId = env.clientId, signal } = options;
  let seconds = code.interval;
  for (;;) {
    await wait(seconds * 1000, signal);
    if (Date.now() >= code.expiresAt) throw new DeviceFlowError('expired');
    const payload = await post(
      '/login/oauth/access_token',
      { client_id: clientId, device_code: code.deviceCode, grant_type: GRANT_TYPE },
      options,
    );
    if (typeof payload.access_token === 'string' && payload.access_token !== '') {
      return payload.access_token;
    }
    if (payload.error === 'slow_down') seconds += SLOW_DOWN_SECONDS;
  }
}

/**
 * Checks the token the flow returned like a pasted one (viewer query + scopes from `GET /user`)
 * and builds the `AuthState`, recorded as an `oauth` sign-in. Throws `GitHubError`.
 */
export async function validateDeviceToken(
  token: string,
  options: { apiUrl?: string; fetch?: FetchLike } = {},
): Promise<PatValidation> {
  const { auth, warning } = await validatePat(token, options);
  return { auth: { ...auth, method: 'oauth' }, warning };
}
