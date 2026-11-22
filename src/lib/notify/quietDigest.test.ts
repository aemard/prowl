import { describe, expect, it } from 'vitest';
import { prEvent } from '../../../tests/fixtures/events';
import { freshHeld, HELD_TTL_MS, holdEvents, MAX_HELD } from './quietDigest';

const NOW = Date.parse('2026-10-06T23:00:00.000Z');

describe('holdEvents', () => {
  it('adds the events not held yet, with when they were held', () => {
    const one = prEvent({ number: 1 });
    const held = holdEvents([], [one], NOW);
    expect(held).toEqual([{ event: one, heldAt: '2026-10-06T23:00:00.000Z' }]);
    expect(holdEvents(held, [one, prEvent({ number: 2 })], NOW + 1000)).toHaveLength(2);
  });

  it(`keeps the newest ${MAX_HELD}`, () => {
    const events = Array.from({ length: MAX_HELD + 5 }, (_, i) => prEvent({ number: i + 1 }));
    const held = holdEvents([], events, NOW);
    expect(held).toHaveLength(MAX_HELD);
    expect(held[0]?.event.number).toBe(6);
  });
});

describe('freshHeld', () => {
  it('drops what waited a day or more, and anything malformed', () => {
    const held = holdEvents([], [prEvent({ number: 1 })], NOW);
    expect(freshHeld(held, NOW + HELD_TTL_MS - 1)).toEqual(held);
    expect(freshHeld(held, NOW + HELD_TTL_MS)).toEqual([]);
    expect(freshHeld([{ heldAt: 'never', event: prEvent() }, { event: {} }, null], NOW)).toEqual(
      [],
    );
    expect(freshHeld(undefined, NOW)).toEqual([]);
    expect(freshHeld({ events: [] }, NOW)).toEqual([]);
  });
});
