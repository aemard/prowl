import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../tests/fixtures/http';
import { setItem } from '../lib/storage/storage';
import { buildAuth } from '../test/panel';
import { checkFastLane } from './fastLane';
import { poll } from './poller';

vi.mock('./poller', async (original) => ({
  ...(await original<typeof import('./poller')>()),
  poll: vi.fn(async () => null),
}));

const LAST = 'Thu, 05 Nov 2026 10:00:00 GMT';
let answer: () => Response;
const fetch = vi.fn(async () => answer());
const inbox = async () => (await chrome.storage.session.get('inbox')).inbox;

describe('checkFastLane', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetch);
    fetch.mockClear();
    vi.mocked(poll).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('does nothing signed out or with a fine-grained token', async () => {
    await checkFastLane();
    await setItem('auth', { ...buildAuth(), tokenType: 'fine_grained' });
    await checkFastLane();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('polls when a pull request thread changed since the last check', async () => {
    await setItem('auth', buildAuth());
    const pr = [{ subject: { type: 'PullRequest' } }];
    answer = () => jsonResponse(pr, { headers: { 'last-modified': LAST } });
    await checkFastLane();
    expect(poll).not.toHaveBeenCalled();
    expect(await inbox()).toEqual({ lastModified: LAST });

    answer = () => new Response(null, { status: 304 });
    await checkFastLane();
    expect(poll).not.toHaveBeenCalled();

    answer = () => jsonResponse(pr, { headers: { 'last-modified': 'later' } });
    await checkFastLane();
    expect(poll).toHaveBeenCalledWith({ afterCurrent: true });
  });

  it('stops asking for the session when the token cannot read the inbox', async () => {
    await setItem('auth', buildAuth());
    answer = () => jsonResponse({ message: 'Resource not accessible' }, { status: 403 });
    await checkFastLane();
    expect(await inbox()).toEqual({ lastModified: null, off: true });
    await checkFastLane();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
