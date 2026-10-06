import { act } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAuth } from '../../test/panel';
import { navigate, resolveRoute, route } from './router';
import { auth } from './store';

afterEach(() => {
  auth.value = undefined;
  location.hash = '';
});

describe('resolveRoute', () => {
  it.each([
    ['', false, 'onboarding'],
    ['#/', false, 'onboarding'],
    ['#/settings', false, 'onboarding'],
    ['#/onboarding', false, 'onboarding'],
    ['', true, 'list'],
    ['#/', true, 'list'],
    ['#/settings', true, 'settings'],
    ['#/onboarding', true, 'onboarding'],
    ['#/nope', true, 'list'],
  ] as const)('hash %j, signed in %s -> %s', (hash, signedIn, expected) => {
    expect(resolveRoute(hash, signedIn)).toBe(expected);
  });
});

describe('route', () => {
  it('lands signed-out users on onboarding and signed-in users on the list', () => {
    expect(route.value).toBe('onboarding');
    auth.value = buildAuth();
    expect(route.value).toBe('list');
    auth.value = undefined;
    expect(route.value).toBe('onboarding');
  });

  it('follows the hash and navigate()', async () => {
    auth.value = buildAuth();
    await act(() => navigate('settings'));
    expect(location.hash).toBe('#/settings');
    expect(route.value).toBe('settings');

    await act(() => navigate('list'));
    expect(route.value).toBe('list');

    // A hash changed from outside navigate() arrives as a hashchange event.
    const changed = new Promise((done) =>
      window.addEventListener('hashchange', done, { once: true }),
    );
    await act(async () => {
      location.hash = '#/onboarding';
      await changed;
    });
    expect(route.value).toBe('onboarding');
  });
});
