import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { viewerNode } from '../../../../tests/fixtures/github';
import { jsonResponse } from '../../../../tests/fixtures/http';
import type { FetchLike } from '../client';
import {
  AUTH_DOCS_URL,
  type DeviceCode,
  DeviceFlowError,
  pollForToken,
  requestDeviceCode,
  validateDeviceToken,
} from './deviceFlow';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const OPTIONS = { clientId: 'client-1' };
const TOKEN = 'gho_OAuthAccessTokenValue0123456789abcdef';

const CODE: DeviceCode = {
  deviceCode: 'device-secret',
  userCode: 'WDJB-MJHT',
  verificationUri: 'https://github.com/login/device',
  expiresAt: NOW + 900_000,
  interval: 5,
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A fetch that answers with each response in turn (the last one repeats). */
function answers(...responses: Array<Response | (() => Response)>) {
  let call = 0;
  return vi.fn<FetchLike>(async () => {
    const next = responses[Math.min(call++, responses.length - 1)];
    return typeof next === 'function' ? next() : (next?.clone() as Response);
  });
}

/** A fetch that never answers; like the real one it fails once its signal aborts. */
const hangs = () =>
  vi.fn<FetchLike>(
    (_url, { signal }) =>
      new Promise<Response>((_, reject) => {
        const fail = () => reject(new TypeError('aborted'));
        if (signal?.aborted) fail();
        signal?.addEventListener('abort', fail);
      }),
  );

const deviceCodeBody = {
  device_code: 'device-secret',
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};

describe('requestDeviceCode', () => {
  it('asks GitHub for a code with the repo scope and maps the answer', async () => {
    const fetch = answers(jsonResponse(deviceCodeBody));

    const code = await requestDeviceCode({ ...OPTIONS, fetch });

    expect(code).toEqual(CODE);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://github.com/login/device/code');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ Accept: 'application/json' });
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      client_id: 'client-1',
      scope: 'repo read:org',
    });
  });

  it('uses the build configuration and the global fetch by default', async () => {
    const fetch = vi.fn(async () => jsonResponse(deviceCodeBody));
    vi.stubGlobal('fetch', fetch);

    await requestDeviceCode();

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://github.com/login/device/code');
    expect(Object.fromEntries(init.body as URLSearchParams)).toMatchObject({
      client_id: 'test-client-id',
    });
  });

  it('talks to the configured web URL', async () => {
    const fetch = answers(jsonResponse(deviceCodeBody));
    await requestDeviceCode({ ...OPTIONS, fetch, webUrl: 'http://127.0.0.1:4010' });
    expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4010/login/device/code');
  });

  it('falls back to the default interval when GitHub sends none', async () => {
    const { interval: _, ...body } = deviceCodeBody;
    const code = await requestDeviceCode({ ...OPTIONS, fetch: answers(jsonResponse(body)) });
    expect(code.interval).toBe(5);
  });

  it('is unsupported without a client id, before calling GitHub', async () => {
    const fetch = answers(jsonResponse(deviceCodeBody));
    await expect(requestDeviceCode({ clientId: '', fetch })).rejects.toMatchObject({
      reason: 'unsupported',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['device flow disabled', jsonResponse({ error: 'device_flow_disabled' }), 'unsupported'],
    ['an unknown client', jsonResponse({ error: 'Not Found' }, { status: 404 }), 'unsupported'],
    ['a 404 without a body', jsonResponse(undefined, { status: 404 }), 'unsupported'],
    ['a server error', jsonResponse({ message: 'oops' }, { status: 502 }), 'server'],
    ['an answer without the code', jsonResponse({ user_code: 'WDJB-MJHT' }), 'server'],
    ['an answer that is not JSON', new Response('<html>', { status: 200 }), 'server'],
    ['an error GitHub does not document', jsonResponse({ error: 'teapot' }), 'server'],
  ])('fails on %s', async (_name, response, reason) => {
    const failure = await requestDeviceCode({ ...OPTIONS, fetch: answers(response) }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(DeviceFlowError);
    expect(failure).toMatchObject({ reason });
  });

  it('reports a network failure without what fetch said', async () => {
    const fetch = vi.fn<FetchLike>().mockRejectedValue(new TypeError('failed to fetch client-1'));
    const failure = await requestDeviceCode({ ...OPTIONS, fetch }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ reason: 'network' });
    expect(String((failure as Error).message)).not.toContain('client-1');
  });

  it('gives up on a request GitHub never answers', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    const fetch = hangs();
    await expect(requestDeviceCode({ ...OPTIONS, fetch })).rejects.toMatchObject({
      reason: 'network',
    });
  });

  it('rejects with the abort reason when cancelled', async () => {
    const controller = new AbortController();
    const fetch = hangs();
    const request = requestDeviceCode({ ...OPTIONS, fetch, signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('pollForToken', () => {
  const pending = () => jsonResponse({ error: 'authorization_pending' });
  const approved = () => jsonResponse({ access_token: TOKEN, token_type: 'bearer', scope: 'repo' });

  it('waits for the interval, polls until the user approves and returns the token', async () => {
    const fetch = answers(pending, pending, approved);
    const result = pollForToken(CODE, { ...OPTIONS, fetch });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toBe(TOKEN);
    const [url, init] = fetch.mock.calls[2] ?? [];
    expect(url).toBe('https://github.com/login/oauth/access_token');
    expect(init?.method).toBe('POST');
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      client_id: 'client-1',
      device_code: 'device-secret',
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
  });

  it('polls 5 seconds slower after slow_down, and keeps that pace', async () => {
    const fetch = answers(
      () => jsonResponse({ error: 'slow_down', interval: 10 }),
      pending,
      approved,
    );
    const result = pollForToken(CODE, { ...OPTIONS, fetch });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe(TOKEN);
  });

  it.each([
    ['expired_token', 'expired'],
    ['access_denied', 'denied'],
    ['device_flow_disabled', 'unsupported'],
    ['unauthorized_client', 'unsupported'],
    ['incorrect_client_credentials', 'unsupported'],
    ['unsupported_grant_type', 'unsupported'],
    ['incorrect_device_code', 'server'],
  ])('%s ends the flow as %s', async (error, reason) => {
    const fetch = answers(jsonResponse({ error }));
    const result = pollForToken(CODE, { ...OPTIONS, fetch });
    const outcome = result.catch((failure: unknown) => failure);

    await vi.advanceTimersByTimeAsync(5_000);

    const failure = await outcome;
    expect(failure).toBeInstanceOf(DeviceFlowError);
    expect(failure).toMatchObject({ reason });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('expires on its own when the code runs out between two polls', async () => {
    const fetch = answers(pending);
    const result = pollForToken({ ...CODE, expiresAt: NOW + 7_000 }, { ...OPTIONS, fetch });
    const outcome = result.catch((failure: unknown) => failure);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(await outcome).toMatchObject({ reason: 'expired' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ends the flow when a request fails', async () => {
    const fetch = vi.fn<FetchLike>().mockRejectedValue(new TypeError('offline'));
    const outcome = pollForToken(CODE, { ...OPTIONS, fetch }).catch((failure: unknown) => failure);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(await outcome).toMatchObject({ reason: 'network' });
  });

  it('stops waiting as soon as it is cancelled', async () => {
    const fetch = answers(pending);
    const controller = new AbortController();
    const outcome = pollForToken(CODE, { ...OPTIONS, fetch, signal: controller.signal }).catch(
      (failure: unknown) => failure,
    );

    await vi.advanceTimersByTimeAsync(2_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops polling when it is cancelled during a request', async () => {
    const controller = new AbortController();
    const fetch = hangs();
    const outcome = pollForToken(CODE, { ...OPTIONS, fetch, signal: controller.signal }).catch(
      (failure: unknown) => failure,
    );

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not start when it is already cancelled', async () => {
    const fetch = answers(pending);
    const outcome = pollForToken(CODE, { ...OPTIONS, fetch, signal: AbortSignal.abort() }).catch(
      (failure: unknown) => failure,
    );

    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('validateDeviceToken', () => {
  function github(scopes: string) {
    return vi.fn<FetchLike>(async (url) =>
      url.endsWith('/graphql')
        ? jsonResponse({ data: { viewer: viewerNode() } })
        : jsonResponse({ login: 'octocat' }, { headers: { 'x-oauth-scopes': scopes } }),
    );
  }

  it('checks the token like a pasted one and records an oauth sign-in', async () => {
    const fetch = github('read:org, repo');

    const { auth, warning } = await validateDeviceToken(TOKEN, { fetch });

    expect(auth).toEqual({
      method: 'oauth',
      token: TOKEN,
      tokenType: 'oauth',
      scopes: ['read:org', 'repo'],
      viewer: viewerNode(),
      createdAt: new Date(NOW).toISOString(),
    });
    expect(warning).toBeNull();
    expect(fetch.mock.calls[0]?.[1].headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  it('warns when GitHub granted less than the repo scope', async () => {
    const { warning } = await validateDeviceToken(TOKEN, { fetch: github('read:user') });
    expect(warning).toMatch(/no repo scope/);
  });
});

describe('AUTH_DOCS_URL', () => {
  it('points at the auth docs on GitHub, where the panel is allowed to open links', () => {
    expect(AUTH_DOCS_URL).toBe('https://github.com/aemard/prowl/blob/main/docs/auth.md');
  });
});
