import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { headCommit, prNode, viewerNode } from '../../tests/fixtures/github';
import { mapPullRequest } from '../lib/github/mapPullRequest';
import type { PullRequest, Snapshot } from '../lib/model';
import { markSeen, snooze, updatePrLocal } from '../lib/storage/prLocal';
import { updateSettings } from '../lib/storage/settings';
import { setItem } from '../lib/storage/storage';
import { fakeChrome } from '../test/chrome';
import { BADGE_COLORS, clearBadge, updateBadge, watchBadge } from './badge';

const failing = mapPullRequest(prNode({ number: 1, commits: headCommit({ FAILURE: 1 }) }));
const ready = mapPullRequest(prNode({ number: 2, mergeStateStatus: 'CLEAN' }));

function snapshot(...prs: PullRequest[]): Snapshot {
  return {
    fetchedAt: '2026-10-06T11:59:00Z',
    viewer: viewerNode(),
    pullRequests: Object.fromEntries(prs.map((pr) => [pr.id, pr])),
    sections: { authored: prs.map(({ id }) => id) },
  };
}

const shown = () => fakeChrome().__state.badge;
/** Waits for the repaint a storage change triggers. */
const repainted = (text: string) => vi.waitFor(() => expect(shown().text).toBe(text));

describe('updateBadge', () => {
  it('paints the count, the color and the tooltip from the stored snapshot', async () => {
    await setItem('snapshot', snapshot(failing, ready));
    await updateBadge();
    expect(shown()).toEqual({
      text: '2',
      color: BADGE_COLORS.danger,
      title: 'Prowl: 2 pull requests needing attention (1 CI failing, 1 ready to merge)',
    });

    await setItem('snapshot', snapshot(ready));
    await updateBadge();
    expect(shown()).toMatchObject({ text: '1', color: BADGE_COLORS.accent });
  });

  it('is empty without a snapshot', async () => {
    await chrome.action.setBadgeText({ text: '3' });
    await updateBadge();
    expect(shown()).toMatchObject({ text: '', title: 'Prowl' });
  });

  it('follows settings.badge', async () => {
    await setItem('snapshot', snapshot(failing));
    await updateSettings({ badge: 'unseen' });
    await updateBadge();
    expect(shown().text).toBe('1');
    await updateSettings({ badge: 'off' });
    await updateBadge();
    expect(shown().text).toBe('');
  });

  it('leaves the latest storage on screen when calls overlap', async () => {
    await setItem('snapshot', snapshot(failing, ready));
    const first = updateBadge();
    await setItem('snapshot', snapshot(ready));
    await Promise.all([first, updateBadge()]);
    expect(shown().text).toBe('1');
  });

  it('never rejects: a failing badge is logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(chrome.action, 'setBadgeText').mockRejectedValue(new Error('no action'));
    await expect(updateBadge()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('Prowl: updating the badge failed', expect.any(Error));
  });
});

describe('clearBadge', () => {
  it('empties the badge and the tooltip whatever is stored', async () => {
    await setItem('snapshot', snapshot(failing));
    await updateBadge();
    await clearBadge();
    expect(shown()).toMatchObject({ text: '', title: 'Prowl' });
  });
});

describe('watchBadge', () => {
  it('repaints when a poll stores a snapshot', async () => {
    watchBadge();
    await setItem('snapshot', snapshot(failing));
    await repainted('1');
    await chrome.storage.local.remove('snapshot');
    await repainted('');
  });

  it('repaints when the local state changes: snooze and seen', async () => {
    await setItem('snapshot', snapshot(failing, ready));
    watchBadge();
    await updateSettings({ badge: 'unseen' });
    await repainted('2');

    await updatePrLocal((state) => markSeen(state, failing.id, failing.updatedAt));
    await repainted('1');
    await updatePrLocal((state) => snooze(state, ready.id, Date.now() + 3_600_000));
    await repainted('');
  });

  it('repaints when the badge setting changes', async () => {
    await setItem('snapshot', snapshot(failing));
    await updateBadge();
    watchBadge();
    await updateSettings({ badge: 'off' });
    await repainted('');
    await updateSettings({ badge: 'attention' });
    await repainted('1');
  });
});

describe('BADGE_COLORS', () => {
  it('match the danger and accent tokens', () => {
    const tokens = readFileSync('src/styles/tokens.css', 'utf8');
    const light = (name: string) =>
      new RegExp(`--color-${name}-solid: (#[0-9a-f]{6});`).exec(tokens)?.[1];
    expect(BADGE_COLORS).toEqual({ danger: light('danger'), accent: light('accent') });
  });
});
