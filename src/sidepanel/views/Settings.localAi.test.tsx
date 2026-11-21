import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiState } from '../state/localAi';
import { open, saved, toggle } from './Settings.test-support';

const g = globalThis as Record<string, unknown>;

describe('SettingsView on-device AI', () => {
  afterEach(() => {
    delete g.LanguageModel;
    aiState.value = {};
  });

  it('is off by default, and says when this browser cannot run it', async () => {
    await open();
    const ai = toggle('On-device AI from Chrome');
    expect(ai.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(ai);
    await waitFor(async () => expect((await saved()).localAi).toBe(true));
    expect(await screen.findByText(/^Not available in this browser/)).toBeTruthy();
  });

  it('downloads the model from a click, showing progress, until it is ready', async () => {
    let state = 'downloadable';
    let finish = () => {};
    g.LanguageModel = {
      availability: async () => state,
      create: vi.fn(
        (options: { monitor: (m: unknown) => void }) =>
          new Promise((resolve) => {
            options.monitor({
              addEventListener: (_: string, listener: (e: { loaded: number }) => void) =>
                listener({ loaded: 0.42 }),
            });
            finish = () => {
              state = 'available';
              resolve({ destroy: () => {} });
            };
          }),
      ),
    };
    await open({ localAi: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Download the model' }));
    expect((await screen.findByText(/Downloading the model/)).textContent).toContain('42');
    finish();
    expect(await screen.findByText(/Ready on this device/)).toBeTruthy();
  });
});
