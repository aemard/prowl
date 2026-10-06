import { describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../../test/chrome';
import type { PrLocalState } from '../model';
import {
  emptyPrLocal,
  isMuted,
  isSeen,
  isSnoozed,
  loadPrLocal,
  markSeen,
  mute,
  normalizePrLocal,
  pruneExpired,
  snooze,
  subscribePrLocal,
  unmute,
  unsnooze,
  updatePrLocal,
} from './prLocal';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function state(partial: Partial<PrLocalState> = {}): PrLocalState {
  return { ...emptyPrLocal(), ...partial };
}

describe('normalizePrLocal', () => {
  it.each([undefined, null, 'x', 3, []])('returns empty state for %j', (value) => {
    expect(normalizePrLocal(value)).toEqual(emptyPrLocal());
  });

  it('keeps valid entries and drops invalid ones', () => {
    expect(
      normalizePrLocal({
        snoozed: { PR_a: iso(NOW), PR_b: 'soon', PR_c: 5, '': iso(NOW) },
        muted: { PR_a: true, PR_b: false, PR_c: 'true' },
        seen: { PR_a: '2026-10-01T00:00:00Z', PR_b: null },
        extra: { PR_a: true },
      }),
    ).toEqual({
      snoozed: { PR_a: iso(NOW) },
      muted: { PR_a: true },
      seen: { PR_a: '2026-10-01T00:00:00Z' },
    });
    expect(normalizePrLocal({ snoozed: [iso(NOW)], muted: 'PR_a' })).toEqual(emptyPrLocal());
  });

  it('returns a fresh empty state each time', () => {
    const a = emptyPrLocal();
    a.muted.PR_a = true;
    expect(emptyPrLocal()).toEqual({ snoozed: {}, muted: {}, seen: {} });
  });
});

describe('snooze', () => {
  it('stores the end time as ISO from a Date or epoch ms, without mutating', () => {
    const before = state();
    const after = snooze(before, 'PR_a', new Date(NOW + HOUR));
    expect(after.snoozed).toEqual({ PR_a: iso(NOW + HOUR) });
    expect(before).toEqual(emptyPrLocal());
    expect(snooze(after, 'PR_a', NOW + 2 * HOUR).snoozed).toEqual({ PR_a: iso(NOW + 2 * HOUR) });
  });

  it('returns the same state when the snooze is unchanged', () => {
    const snoozed = snooze(state(), 'PR_a', NOW + HOUR);
    expect(snooze(snoozed, 'PR_a', new Date(NOW + HOUR))).toBe(snoozed);
  });

  it('throws on an invalid date', () => {
    expect(() => snooze(state(), 'PR_a', Number.NaN)).toThrow(RangeError);
    expect(() => snooze(state(), 'PR_a', new Date('nope'))).toThrow(RangeError);
  });

  it('unsnoozes, and is a no-op for a PR that is not snoozed', () => {
    const snoozed = snooze(snooze(state(), 'PR_a', NOW + HOUR), 'PR_b', NOW + HOUR);
    expect(unsnooze(snoozed, 'PR_a').snoozed).toEqual({ PR_b: iso(NOW + HOUR) });
    expect(snoozed.snoozed).toHaveProperty('PR_a');
    expect(unsnooze(snoozed, 'PR_c')).toBe(snoozed);
    expect(unsnooze(snoozed, 'toString')).toBe(snoozed);
  });
});

describe('isSnoozed', () => {
  const snoozed = snooze(state(), 'PR_a', NOW + HOUR);

  it('is true until the end time, exclusive', () => {
    expect(isSnoozed(snoozed, 'PR_a', NOW)).toBe(true);
    expect(isSnoozed(snoozed, 'PR_a', new Date(NOW + HOUR - 1))).toBe(true);
    expect(isSnoozed(snoozed, 'PR_a', NOW + HOUR)).toBe(false);
    expect(isSnoozed(snoozed, 'PR_a', NOW + 2 * HOUR)).toBe(false);
  });

  it('is false for PRs that were never snoozed', () => {
    expect(isSnoozed(snoozed, 'PR_b', NOW)).toBe(false);
    expect(isSnoozed(snoozed, 'constructor', NOW)).toBe(false);
  });
});

describe('mute', () => {
  it('mutes and unmutes, returning the same state for no-ops', () => {
    const muted = mute(state(), 'PR_a');
    expect(muted.muted).toEqual({ PR_a: true });
    expect(isMuted(muted, 'PR_a')).toBe(true);
    expect(isMuted(muted, 'PR_b')).toBe(false);
    expect(isMuted(muted, 'hasOwnProperty')).toBe(false);
    expect(mute(muted, 'PR_a')).toBe(muted);

    const unmuted = unmute(muted, 'PR_a');
    expect(unmuted.muted).toEqual({});
    expect(isMuted(unmuted, 'PR_a')).toBe(false);
    expect(unmute(unmuted, 'PR_a')).toBe(unmuted);
    expect(isMuted(muted, 'PR_a')).toBe(true);
  });
});

describe('markSeen / isSeen', () => {
  const updatedAt = '2026-10-06T10:00:00Z';
  const later = '2026-10-06T11:00:00Z';

  it('records the updatedAt the user has seen', () => {
    const seen = markSeen(state(), 'PR_a', updatedAt);
    expect(seen.seen).toEqual({ PR_a: updatedAt });
    expect(isSeen(seen, 'PR_a', updatedAt)).toBe(true);
    expect(isSeen(seen, 'PR_a', '2026-10-06T09:00:00Z')).toBe(true);
    expect(isSeen(seen, 'PR_a', later)).toBe(false);
    expect(isSeen(seen, 'PR_b', updatedAt)).toBe(false);
    expect(isSeen(seen, 'PR_a', 'garbage')).toBe(false);
  });

  it('moves forward but never backwards', () => {
    const seen = markSeen(state(), 'PR_a', updatedAt);
    expect(markSeen(seen, 'PR_a', later).seen.PR_a).toBe(later);
    expect(markSeen(seen, 'PR_a', updatedAt)).toBe(seen);
    expect(markSeen(seen, 'PR_a', '2026-10-05T00:00:00Z')).toBe(seen);
  });

  it('ignores invalid timestamps', () => {
    const empty = state();
    expect(markSeen(empty, 'PR_a', 'yesterday')).toBe(empty);
  });
});

describe('pruneExpired', () => {
  const full = state({
    snoozed: { PR_ended: iso(NOW - HOUR), PR_now: iso(NOW), PR_active: iso(NOW + HOUR) },
    muted: { PR_active: true, PR_gone: true },
    seen: { PR_active: '2026-10-01T00:00:00Z', PR_gone: '2026-10-01T00:00:00Z' },
  });

  it('drops snoozes that have ended and keeps everything else without known ids', () => {
    expect(pruneExpired(full, NOW)).toEqual({
      ...full,
      snoozed: { PR_active: iso(NOW + HOUR) },
    });
    expect(full.snoozed).toHaveProperty('PR_ended');
  });

  it('drops every entry for PRs that are no longer known', () => {
    expect(pruneExpired(full, new Date(NOW), new Set(['PR_active', 'PR_new']))).toEqual({
      snoozed: { PR_active: iso(NOW + HOUR) },
      muted: { PR_active: true },
      seen: { PR_active: '2026-10-01T00:00:00Z' },
    });
    expect(pruneExpired(full, NOW, [])).toEqual(emptyPrLocal());
  });

  it('returns the same state when there is nothing to prune', () => {
    const clean = pruneExpired(full, NOW, ['PR_active']);
    expect(pruneExpired(clean, NOW, ['PR_active'])).toBe(clean);
    const empty = state();
    expect(pruneExpired(empty, NOW, ['PR_a'])).toBe(empty);
  });
});

describe('prLocal storage', () => {
  it('loads empty state on first run without writing', async () => {
    expect(await loadPrLocal()).toEqual(emptyPrLocal());
    expect(fakeChrome().storage.local.data.has('prLocal')).toBe(false);
  });

  it('loads stored state normalized', async () => {
    await chrome.storage.local.set({ prLocal: { muted: { PR_a: true, PR_b: 1 } } });
    expect(await loadPrLocal()).toEqual(state({ muted: { PR_a: true } }));
  });

  it('applies combined operations in one write', async () => {
    const listener = vi.fn();
    chrome.storage.local.onChanged.addListener(listener);
    const stored = await updatePrLocal((current) =>
      markSeen(mute(snooze(current, 'PR_a', NOW + HOUR), 'PR_b'), 'PR_a', '2026-10-06T10:00:00Z'),
    );
    expect(stored).toEqual({
      snoozed: { PR_a: iso(NOW + HOUR) },
      muted: { PR_b: true },
      seen: { PR_a: '2026-10-06T10:00:00Z' },
    });
    expect(await loadPrLocal()).toEqual(stored);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('skips the write when an operation changes nothing', async () => {
    await updatePrLocal((current) => mute(current, 'PR_a'));
    const set = vi.spyOn(chrome.storage.local, 'set');
    await updatePrLocal((current) => mute(current, 'PR_a'));
    await updatePrLocal((current) => pruneExpired(current, NOW, ['PR_a']));
    expect(set).not.toHaveBeenCalled();
  });

  it('does not lose concurrent updates from different callers', async () => {
    await Promise.all([
      updatePrLocal((current) => mute(current, 'PR_a')),
      updatePrLocal((current) => snooze(current, 'PR_b', NOW + HOUR)),
      updatePrLocal((current) => markSeen(current, 'PR_c', '2026-10-06T10:00:00Z')),
      updatePrLocal((current) => mute(current, 'PR_d')),
    ]);
    expect(await loadPrLocal()).toEqual({
      snoozed: { PR_b: iso(NOW + HOUR) },
      muted: { PR_a: true, PR_d: true },
      seen: { PR_c: '2026-10-06T10:00:00Z' },
    });
  });

  it('notifies subscribers with normalized state', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribePrLocal(listener);
    await chrome.storage.local.set({ prLocal: { muted: { PR_a: true }, seen: 'bad' } });
    await chrome.storage.local.remove('prLocal');
    unsubscribe();
    await updatePrLocal((current) => mute(current, 'PR_z'));
    expect(listener.mock.calls).toEqual([[state({ muted: { PR_a: true } })], [emptyPrLocal()]]);
  });
});
