import { act, render, screen } from '@testing-library/preact';
import { beforeEach, expect, it, vi } from 'vitest';
import { computeBadge } from '../../lib/badge/computeBadge';
import { buildSnapshotOf } from '../../test/panel';
import { prLocal, settings, snapshot } from '../state/store';
import { ListView } from './List';
import { NOW, observer, pr, withSections } from './List.test-support';

const a = pr(1, { updatedAt: '2026-10-06T10:00:00.000Z' });
const b = pr(2, { updatedAt: '2026-10-06T09:00:00.000Z' });
const c = pr(3, { updatedAt: '2026-10-06T08:00:00.000Z' });
const markSeen = (send: { mock: { calls: unknown[][] } }) =>
  send.mock.calls
    .map(([message]) => message)
    .filter((m) => (m as { type: string }).type === 'markSeen');

beforeEach(() => {
  snapshot.value = buildSnapshotOf({ authored: [a, b, c] });
  prLocal.value = {
    snoozed: {},
    muted: {},
    seen: { [b.id]: b.updatedAt, [c.id]: '2026-10-05T00:00:00.000Z' },
  };
});

it('unseen changes puts a dot on cards changed since they were seen, as many as the unseen badge counts', () => {
  render(<ListView />);
  const dots = [...document.querySelectorAll('.pr-card__summary')].map((card) =>
    card.getAttribute('data-unseen'),
  );
  expect(dots).toEqual(['true', null, 'true']);
  const badge = computeBadge(snapshot.value, prLocal.value, 'unseen', settings.value, NOW);
  expect(badge.text).toBe(String(dots.filter(Boolean).length));
});

it('unseen changes does not count a card behind the section bar as on screen', () => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(49);
  render(<ListView />);
  expect(observer().options).toEqual({ threshold: 0.6, rootMargin: '0px 0px 0px 0px' });

  // Turning a second section on brings the bar, and a new observer that leaves it out.
  act(() => withSections(['authored', 'mentioned']));
  expect(screen.getByRole('tablist')).toBeTruthy();
  expect(observer().options?.rootMargin).toBe('0px 0px -49px 0px');
});

it('unseen changes marks the unseen cards that stayed on screen for 1.5 s, once', () => {
  const send = vi.spyOn(chrome.runtime, 'sendMessage');
  render(<ListView />);
  observer().show([a.id, b.id]);

  act(() => void vi.advanceTimersByTime(1499));
  expect(markSeen(send)).toEqual([]);
  act(() => void vi.advanceTimersByTime(1));
  expect(markSeen(send)).toEqual([{ type: 'markSeen', prIds: [a.id] }]);

  act(() => void vi.advanceTimersByTime(10_000));
  expect(markSeen(send)).toHaveLength(1);
});

it('unseen changes reports cards on screen as priority without forcing a poll, then clears it when hidden', async () => {
  const send = vi.spyOn(chrome.runtime, 'sendMessage');
  render(<ListView />);
  observer().show([a.id]);
  await act(async () => {});
  expect(send).toHaveBeenCalledWith({ type: 'mergePriority', prIds: [a.id] });
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'poll' }));
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await act(async () => {});
  expect(send).toHaveBeenLastCalledWith({ type: 'mergePriority', prIds: [] });
});

it('unseen changes waits again after a scroll, and skips cards that left the screen', () => {
  const send = vi.spyOn(chrome.runtime, 'sendMessage');
  render(<ListView />);
  observer().show([a.id]);
  act(() => void vi.advanceTimersByTime(1000));
  observer().show([a.id, c.id]);
  act(() => void vi.advanceTimersByTime(1000));
  expect(markSeen(send)).toEqual([]);
  observer().show([c.id]);
  act(() => void vi.advanceTimersByTime(1500));
  expect(markSeen(send)).toEqual([{ type: 'markSeen', prIds: [c.id] }]);
});

it('unseen changes does nothing while the panel is hidden, and starts when it shows', () => {
  const send = vi.spyOn(chrome.runtime, 'sendMessage');
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  render(<ListView />);
  observer().show([a.id]);
  act(() => void vi.advanceTimersByTime(5000));
  expect(markSeen(send)).toEqual([]);

  Reflect.deleteProperty(document, 'visibilityState');
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
  act(() => void vi.advanceTimersByTime(1500));
  expect(markSeen(send)).toEqual([{ type: 'markSeen', prIds: [a.id] }]);
});

it('unseen changes drops the dot once the worker has stored it as seen', () => {
  render(<ListView />);
  act(() => {
    prLocal.value = { ...prLocal.value, seen: { ...prLocal.value.seen, [a.id]: a.updatedAt } };
  });
  expect(document.querySelectorAll('[data-unseen]')).toHaveLength(1);
});
