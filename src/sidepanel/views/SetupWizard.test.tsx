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
  it('lists discovered teams by organization, follows all by default and saves exclusions on Continue', async () => {
    await chrome.storage.local.set({
      teams: {
        login: 'octocat',
        fetchedAt: new Date().toISOString(),
        teams: [
          { org: 'acme', slug: 'platform', name: 'Platform Engineering' },
          { org: 'acme', slug: 'security', name: 'Security' },
          { org: 'octo', slug: 'web', name: 'Web' },
        ],
        error: null,
      },
    });
    await open();
    expect(screen.queryByRole('region', { name: 'Teams to follow' })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Team reviews' }));
    expect(screen.getByRole('region', { name: 'Teams to follow' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'acme' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'octo' })).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: 'Platform Engineering' }).getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('switch', { name: 'Security' }));
    expect(screen.getByRole('switch', { name: 'Security' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect((await getItem('settings'))?.unfollowedTeams).toBeUndefined();
    await click('Continue');
    const saved = await getItem('settings');
    expect(saved?.sections.find((s) => s.kind === 'team_review_requested')?.enabled).toBe(true);
    expect(saved?.unfollowedTeams).toEqual(['acme/security']);
  });

  it('keeps saved team exclusions on a setup rerun, without resetting other teams', async () => {
    await chrome.storage.local.set({
      settings: { ...defaultSettings(), unfollowedTeams: ['acme/security', 'legacy/archived'] },
      teams: {
        login: 'octocat',
        fetchedAt: new Date().toISOString(),
        teams: [{ org: 'acme', slug: 'security', name: 'Security' }],
        error: null,
      },
    });
    await open({ status: 'completed' });
    fireEvent.click(screen.getByRole('switch', { name: 'Team reviews' }));
    expect(screen.getByRole('switch', { name: 'Security' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Security' }));
    await click('Continue');
    expect((await getItem('settings'))?.unfollowedTeams).toEqual(['legacy/archived']);
  });

  it('reacts to team discovery arriving after the wizard opens', async () => {
    await open();
    fireEvent.click(screen.getByRole('switch', { name: 'Team reviews' }));
    expect(screen.getByText('Teams are not loaded yet. Refresh to try again.')).toBeTruthy();
    await act(async () => {
      await chrome.storage.local.set({
        teams: {
          login: 'octocat',
          fetchedAt: new Date().toISOString(),
          teams: [{ org: 'acme', slug: 'infra', name: 'Infrastructure' }],
          error: null,
        },
      });
    });
    expect(
      screen.getByRole('switch', { name: 'Infrastructure' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('shows an access error and allows setup without team discovery', async () => {
    await chrome.storage.local.set({
      teams: {
        login: 'octocat',
        fetchedAt: new Date().toISOString(),
        teams: [],
        error: { kind: 'missing_scope', message: 'Missing read:org scope.' },
      },
    });
    await open();
    fireEvent.click(screen.getByRole('switch', { name: 'Team reviews' }));
    expect(screen.getByText(/Missing read:org scope/)).toBeTruthy();
    await click('Continue');
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeTruthy();
    expect((await getItem('settings'))?.unfollowedTeams).toEqual([]);
  });

  it('can retry discovery without saving the draft team selection', async () => {
    await open();
    fireEvent.click(screen.getByRole('switch', { name: 'Team reviews' }));
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    await click('Refresh teams');
    expect(send).toHaveBeenCalledWith({ type: 'refreshTeams' });
    expect((await getItem('settings'))?.unfollowedTeams).toBeUndefined();
  });

  it('does not leak team names from a different account', async () => {
    await chrome.storage.local.set({
      teams: {
        login: 'someone-else',
        fetchedAt: new Date().toISOString(),
        teams: [{ org: 'secret', slug: 'team', name: 'Secret team' }],
        error: null,
      },
    });
    await open();
    fireEvent.click(screen.getByRole('switch', { name: 'Team reviews' }));
    expect(screen.queryByText('Secret team')).toBeNull();
  });

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
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Your pull requests' })).toBeTruthy(),
    );
    expect(await getItem('onboarding')).toEqual({ status: 'pending', nextStep: 0 });
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
