import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../lib/storage/settings';
import { getItem } from '../../lib/storage/storage';
import { buildAuth } from '../../test/panel';
import { toasts } from '../components/ui/Toast';
import { hydrateStore } from '../state/store';
import { SetupWizard } from './SetupWizard';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  location.hash = '';
  toasts.value = [];
});

async function open(
  options: { step?: 0 | 1 | 2; status?: 'pending' | 'completed' | 'skipped' } = {},
) {
  cleanup();
  await chrome.storage.local.set({
    auth: buildAuth(),
    onboarding: { status: options.status ?? 'pending', nextStep: options.step ?? 0 },
  });
  await act(async () => {
    stop = await hydrateStore();
  });
  render(<SetupWizard />);
}

const click = async (label: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: label }));
  });
  // The click handler starts an async chrome.storage write. Preact's act does not await
  // the promise of a void event handler, so wait until that handler finishes.
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: label })?.getAttribute('aria-busy')).toBeFalsy(),
  );
};

describe('SetupWizard', () => {
  it('saves selected PR sections when continuing and preserves custom sections', async () => {
    await chrome.storage.local.set({
      settings: {
        ...defaultSettings(),
        sections: [
          ...defaultSettings().sections,
          { id: 'custom-1', kind: 'custom', label: 'My bugs', enabled: true, query: 'label:bug' },
        ],
      },
    });
    await open();
    expect(screen.getByRole('heading', { name: 'Your pull requests' })).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Review requested' }));
    await click('Continue');
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeTruthy();
    const saved = await getItem('settings');
    expect(saved?.sections.find((s) => s.kind === 'review_requested')?.enabled).toBe(true);
    expect(saved?.sections.find((s) => s.kind === 'custom')?.enabled).toBe(true);
    expect(await getItem('onboarding')).toEqual({ status: 'pending', nextStep: 1 });
  });

  it('saves notifications, then completes setup and shows the PR route', async () => {
    await open({ step: 1 });
    fireEvent.click(screen.getByRole('switch', { name: 'Desktop notifications' }));
    await click('Continue');
    expect((await getItem('settings'))?.notifications.enabled).toBe(true);
    expect(await getItem('onboarding')).toEqual({ status: 'pending', nextStep: 2 });
    expect(screen.getByRole('heading', { name: "You're all set" })).toBeTruthy();
    await click('Open my pull requests');
    expect(await getItem('onboarding')).toEqual({ status: 'completed', nextStep: 0 });
    expect(location.hash).toBe('#/');
  });

  it('skips without applying unsaved settings, even on the first step', async () => {
    await open();
    fireEvent.click(screen.getByRole('switch', { name: 'Review requested' }));
    await click('Skip setup');
    expect(await getItem('onboarding')).toEqual({ status: 'skipped', nextStep: 0 });
    expect(
      (await getItem('settings'))?.sections.find((s) => s.kind === 'review_requested')?.enabled,
    ).not.toBe(true);
    expect(location.hash).toBe('#/');
  });

  it('resumes pending progress but starts a manual rerun at step one', async () => {
    await open({ step: 2 });
    expect(screen.getByRole('heading', { name: "You're all set" })).toBeTruthy();
    stop?.();
    stop = undefined;
    await open({ step: 2, status: 'completed' });
    expect(screen.getByRole('heading', { name: 'Your pull requests' })).toBeTruthy();
  });

  it('goes back and persists its current step', async () => {
    await open({ step: 1 });
    await click('Back');
    expect(await getItem('onboarding')).toEqual({ status: 'pending', nextStep: 0 });
    expect(screen.getByRole('heading', { name: 'Your pull requests' })).toBeTruthy();
  });

  it('does not advance when settings cannot be saved', async () => {
    await open();
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('quota'));
    await click('Continue');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Your pull requests' })).toBeTruthy(),
    );
    expect(await getItem('onboarding')).toEqual({ status: 'pending', nextStep: 0 });
    expect(toasts.value.some(({ tone }) => tone === 'danger')).toBe(true);
  });
});
