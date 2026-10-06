import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../lib/storage/settings';
import { removeItems, setItem, setItems } from '../../lib/storage/storage';
import { buildAuth, buildPollState, buildSnapshot } from '../../test/panel';
import { auth, hydrated, hydrateStore, pollState, prLocal, settings, snapshot } from './store';

let stop: (() => void) | undefined;
const hydrate = async () => {
  stop = await hydrateStore();
};
afterEach(() => stop?.());

describe('hydrateStore', () => {
  it('falls back to defaults and signed out when storage is empty', async () => {
    await hydrate();
    expect(hydrated.value).toBe(true);
    expect(settings.value).toEqual(defaultSettings());
    expect(auth.value).toBeUndefined();
    expect(snapshot.value).toBeUndefined();
    expect(pollState.value).toBeUndefined();
    expect(prLocal.value).toEqual({ snoozed: {}, muted: {}, seen: {} });
  });

  it('loads stored values, normalizing settings and local state', async () => {
    await chrome.storage.local.set({
      settings: { theme: 'dark', pollIntervalMinutes: 999 },
      prLocal: { muted: { PR_1: true, PR_2: 'yes' } },
    });
    await setItems({ auth: buildAuth(), snapshot: buildSnapshot(), pollState: buildPollState() });
    await hydrate();
    expect(settings.value.theme).toBe('dark');
    expect(settings.value.pollIntervalMinutes).toBe(60);
    expect(prLocal.value.muted).toEqual({ PR_1: true });
    expect(auth.value?.viewer.login).toBe('octocat');
    expect(snapshot.value?.fetchedAt).toBe('2026-10-06T11:58:00.000Z');
    expect(pollState.value?.inFlight).toBe(false);
  });

  it('is not hydrated until the first read has been applied', async () => {
    const pending = hydrateStore();
    expect(hydrated.value).toBe(false);
    stop = await pending;
    expect(hydrated.value).toBe(true);
  });

  it('follows changes made later, from any context', async () => {
    await hydrate();
    await setItem('auth', buildAuth('hubot'));
    await setItem('snapshot', buildSnapshot('2026-10-06T12:00:00.000Z'));
    await setItem('pollState', buildPollState({ inFlight: true }));
    await chrome.storage.local.set({
      settings: { theme: 'light' },
      prLocal: { muted: { PR_9: true } },
    });
    expect(auth.value?.viewer.login).toBe('hubot');
    expect(snapshot.value?.fetchedAt).toBe('2026-10-06T12:00:00.000Z');
    expect(pollState.value?.inFlight).toBe(true);
    expect(settings.value.theme).toBe('light');
    expect(prLocal.value.muted).toEqual({ PR_9: true });

    await removeItems('auth', 'snapshot', 'pollState');
    expect(auth.value).toBeUndefined();
    expect(snapshot.value).toBeUndefined();
    expect(pollState.value).toBeUndefined();
  });

  it('prefers a change that arrives during the first read over the older read', async () => {
    await setItem('pollState', buildPollState({ inFlight: true }));
    const pending = hydrateStore();
    // The read above already captured inFlight: true; this write lands before it resolves.
    await setItem('pollState', buildPollState({ inFlight: false }));
    stop = await pending;
    expect(pollState.value?.inFlight).toBe(false);
  });

  it('stops listening when disposed', async () => {
    await hydrate();
    stop?.();
    await setItem('auth', buildAuth('ghost'));
    expect(auth.value).toBeUndefined();
  });
});
