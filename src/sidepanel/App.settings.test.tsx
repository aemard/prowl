import { act, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAuth } from '../test/panel';
import { App } from './App';
import { navigate } from './state/router';
import { changePrLimit } from './state/settings';
import { hydrateStore } from './state/store';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  location.hash = '';
  delete document.documentElement.dataset.theme;
});

async function open(stored: Record<string, unknown> = {}) {
  await chrome.storage.local.set(stored);
  await act(async () => {
    stop = await hydrateStore();
  });
  return render(<App />);
}

describe('App, after "Change limit"', () => {
  it('focuses the PR limit when asked, the first time and once the settings view is loaded', async () => {
    await open({ auth: buildAuth() });
    const limit = () => screen.getByLabelText('Maximum pull requests loaded per section');

    act(() => changePrLimit());
    await screen.findByLabelText('Maximum pull requests loaded per section');
    await waitFor(() => expect(document.activeElement).toBe(limit()));

    await act(() => navigate('list'));
    act(() => changePrLimit());
    await waitFor(() => expect(document.activeElement).toBe(limit()));

    // The request is one-shot: a later visit to Settings lands on the view, not on the field.
    await act(() => navigate('list'));
    await act(() => navigate('settings'));
    expect(document.activeElement).toBe(screen.getByRole('main', { name: 'Settings' }));
    await act(() => navigate('list'));
  });
});
