import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../tests/fixtures/http';
import { setItem } from '../lib/storage/storage';
import { buildAuth, buildPullRequest, buildSnapshotOf } from '../test/panel';
import { checkFastLane, onChromeFocused } from './fastLane';
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

  it('polls every minute while CI runs on a listed pull request, even for fine-grained tokens', async () => {
    await setItem('auth', { ...buildAuth(), tokenType: 'fine_grained' });
    const running = {
      state: 'pending',
      total: 1,
      passed: 0,
      failed: 0,
      pending: 1,
      neutral: 0,
    } as const;
    const old = new Date(Date.now() - 2 * 60_000).toISOString();
    await setItem(
      'snapshot',
      buildSnapshotOf({ authored: [buildPullRequest({ checks: running })] }, { fetchedAt: old }),
    );
    await checkFastLane();
    expect(poll).toHaveBeenCalledWith({ afterCurrent: true });

    vi.mocked(poll).mockClear();
    await setItem(
      'snapshot',
      buildSnapshotOf(
        { authored: [buildPullRequest({ checks: running })] },
        { fetchedAt: new Date().toISOString() },
      ),
    );
    await checkFastLane();
    expect(poll).not.toHaveBeenCalled();
  });
});

describe('onChromeFocused', () => {
  beforeEach(() => vi.mocked(poll).mockClear());

  it('polls when Chrome comes back and the list is older than the interval', async () => {
    await onChromeFocused(chrome.windows.WINDOW_ID_NONE);
    expect(poll).not.toHaveBeenCalled();
    await setItem('snapshot', buildSnapshotOf({}, { fetchedAt: new Date().toISOString() }));
    await onChromeFocused(1);
    expect(poll).not.toHaveBeenCalled();
    const days = new Date(Date.now() - 3 * 24 * 3_600_000).toISOString();
    await setItem('snapshot', buildSnapshotOf({}, { fetchedAt: days }));
    await onChromeFocused(1);
    expect(poll).toHaveBeenCalledTimes(1);
  });
});
