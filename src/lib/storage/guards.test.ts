import { describe, expect, it } from 'vitest';
import { isDateString, isRecord, jsonEqual, toMillis } from './guards';

describe('guards', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    for (const value of [null, undefined, [], 'x', 1, true]) expect(isRecord(value)).toBe(false);
  });

  it('isDateString accepts parseable date strings only', () => {
    expect(isDateString('2026-10-06T12:00:00Z')).toBe(true);
    expect(isDateString('2026-10-06')).toBe(true);
    for (const value of ['soon', '', 0, null, new Date()]) expect(isDateString(value)).toBe(false);
  });

  it('toMillis accepts a Date or epoch ms', () => {
    expect(toMillis(new Date(5))).toBe(5);
    expect(toMillis(7)).toBe(7);
  });

  it('jsonEqual compares JSON values deeply, ignoring key order', () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })).toBe(true);
    expect(jsonEqual(undefined, undefined)).toBe(true);
    expect(jsonEqual(Number.NaN, Number.NaN)).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual({}, [])).toBe(false);
    expect(jsonEqual(undefined, {})).toBe(false);
    expect(jsonEqual('1', 1)).toBe(false);
  });
});
