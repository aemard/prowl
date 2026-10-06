import { describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../../test/chrome';
import type { PollState } from '../model';
import {
  getItem,
  getItems,
  removeItems,
  setItem,
  setItems,
  subscribe,
  updateItem,
  withLock,
} from './storage';

const pollState: PollState = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  nextAllowedAt: null,
  consecutiveFailures: 0,
  rateLimit: null,
  lastError: null,
  inFlight: false,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('get / set / remove', () => {
  it('returns undefined for a key that was never written', async () => {
    expect(await getItem('pollState')).toBeUndefined();
    expect(await getItems(['pollState', 'snapshot'])).toEqual({});
  });

  it('round-trips values through chrome.storage.local only', async () => {
    await setItem('pollState', pollState);
    expect(await getItem('pollState')).toEqual(pollState);
    expect(fakeChrome().storage.local.data.get('pollState')).toEqual(pollState);
    expect(fakeChrome().storage.sync.data.size).toBe(0);
    expect(fakeChrome().storage.session.data.size).toBe(0);
  });

  it('reads several keys at once and skips an empty request', async () => {
    await setItems({ pollState, prLocal: { snoozed: {}, muted: {}, seen: {} } });
    expect(await getItems(['pollState', 'prLocal', 'auth'])).toEqual({
      pollState,
      prLocal: { snoozed: {}, muted: {}, seen: {} },
    });
    const get = vi.spyOn(chrome.storage.local, 'get');
    expect(await getItems([])).toEqual({});
    expect(get).not.toHaveBeenCalled();
  });

  it('writes several keys in one change event and ignores undefined entries', async () => {
    const listener = vi.fn();
    chrome.storage.local.onChanged.addListener(listener);
    await setItems({ pollState, auth: undefined });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.keys(listener.mock.calls[0]?.[0] ?? {})).toEqual(['pollState']);
    expect(fakeChrome().storage.local.data.has('auth')).toBe(false);

    const set = vi.spyOn(chrome.storage.local, 'set');
    await setItems({ auth: undefined });
    expect(set).not.toHaveBeenCalled();
  });

  it('removes several keys and treats an empty call as a no-op', async () => {
    await setItems({ pollState, prLocal: { snoozed: {}, muted: {}, seen: {} } });
    await removeItems('pollState', 'prLocal', 'auth');
    expect(fakeChrome().storage.local.data.size).toBe(0);

    const remove = vi.spyOn(chrome.storage.local, 'remove');
    await removeItems();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('subscribe', () => {
  it('reports new and old values for the subscribed key only', async () => {
    const listener = vi.fn();
    subscribe('pollState', listener);
    await setItem('pollState', pollState);
    await setItem('prLocal', { snoozed: {}, muted: {}, seen: {} });
    const next = { ...pollState, inFlight: true };
    await setItem('pollState', next);
    await removeItems('pollState');
    expect(listener.mock.calls).toEqual([
      [pollState, undefined],
      [next, pollState],
      [undefined, next],
    ]);
  });

  it('ignores other storage areas and stops after unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribe('pollState', listener);
    await chrome.storage.sync.set({ pollState });
    await chrome.storage.session.set({ pollState });
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
    await setItem('pollState', pollState);
    expect(listener).not.toHaveBeenCalled();
    expect(fakeChrome().storage.local.onChanged.hasListeners()).toBe(false);
  });

  it('is not called when a write leaves the value unchanged', async () => {
    await setItem('pollState', pollState);
    const listener = vi.fn();
    subscribe('pollState', listener);
    await setItem('pollState', { ...pollState });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('updateItem', () => {
  it('passes the current value (or undefined) and stores the result', async () => {
    const update = vi.fn((current?: PollState) => ({
      ...(current ?? pollState),
      consecutiveFailures: (current?.consecutiveFailures ?? -1) + 1,
    }));
    expect(await updateItem('pollState', update)).toEqual(pollState);
    expect(update).toHaveBeenLastCalledWith(undefined);
    const stored = await updateItem('pollState', update);
    expect(stored.consecutiveFailures).toBe(1);
    expect(await getItem('pollState')).toEqual(stored);
  });

  it('skips the write when nothing changed', async () => {
    await setItem('pollState', pollState);
    const set = vi.spyOn(chrome.storage.local, 'set');
    expect(await updateItem('pollState', (current) => ({ ...pollState, ...current }))).toEqual(
      pollState,
    );
    expect(set).not.toHaveBeenCalled();
  });

  it('serializes concurrent updates so none is lost', async () => {
    await setItem('pollState', pollState);
    const increment = (current?: PollState) => ({
      ...pollState,
      consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
    });
    await Promise.all([1, 2, 3, 4, 5].map(() => updateItem('pollState', increment)));
    expect((await getItem('pollState'))?.consecutiveFailures).toBe(5);
  });

  it('rejects with the updater error and leaves storage untouched', async () => {
    await setItem('pollState', pollState);
    await expect(
      updateItem('pollState', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await getItem('pollState')).toEqual(pollState);
    // The lock was released.
    await updateItem('pollState', (current) => ({ ...pollState, ...current, inFlight: true }));
    expect((await getItem('pollState'))?.inFlight).toBe(true);
  });
});

describe('withLock', () => {
  it('runs tasks for the same name one at a time, in order', async () => {
    const order: string[] = [];
    const gate = deferred();
    const first = withLock('a', async () => {
      order.push('first:start');
      await gate.promise;
      order.push('first:end');
      return 1;
    });
    const second = withLock('a', async () => {
      order.push('second');
      return 2;
    });
    const other = withLock('b', async () => {
      order.push('other');
      return 3;
    });
    expect(await other).toBe(3);
    gate.resolve();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(order).toEqual(['first:start', 'other', 'first:end', 'second']);
  });

  it('keeps going after a task fails', async () => {
    const failing = withLock('a', async () => {
      throw new Error('nope');
    });
    const next = withLock('a', async () => 'ok');
    await expect(failing).rejects.toThrow('nope');
    expect(await next).toBe('ok');
  });

  it('uses the Web Locks API when the context has it', async () => {
    const request = vi.fn(async (_name: string, task: () => Promise<unknown>) => task());
    vi.stubGlobal('navigator', { locks: { request } });
    expect(await withLock('prowl:test', async () => 42)).toBe(42);
    expect(request).toHaveBeenCalledWith('prowl:test', expect.any(Function));
  });
});
