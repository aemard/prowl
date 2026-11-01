import { act, render, screen, within } from '@testing-library/preact';
import { afterEach } from 'vitest';
import type { AuthState, Section, Settings, TeamsState } from '../../lib/model';
import { defaultSettings, normalizeSettings } from '../../lib/storage/settings';
import { buildAuth } from '../../test/panel';
import { ToastRegion, toasts } from '../components/ui/Toast';
import { auth, hydrateStore } from '../state/store';
import { SettingsView } from './Settings';

export let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  auth.value = undefined;
  toasts.value = [];
  location.hash = '';
});

export async function open(
  settings: Partial<Settings> = {},
  account: AuthState | null = buildAuth(),
  stored: Record<string, unknown> = {},
) {
  await chrome.storage.local.set({
    settings: { ...defaultSettings(), ...settings },
    ...(account ? { auth: account } : {}),
    ...stored,
  });
  await act(async () => {
    stop = await hydrateStore();
  });
  render(
    <>
      <SettingsView />
      <ToastRegion />
    </>,
  );
}

export const saved = async () =>
  normalizeSettings((await chrome.storage.local.get('settings')).settings);

export const group = (title: string) =>
  within(screen.getByRole('heading', { level: 3, name: title }).closest('section') as HTMLElement);

export const toggle = (name: string, scope: Pick<typeof screen, 'getByRole'> = screen) =>
  scope.getByRole('switch', { name });

export const teamsState = (overrides: Partial<TeamsState> = {}): TeamsState => ({
  login: buildAuth().viewer.login,
  fetchedAt: new Date().toISOString(),
  teams: [
    { org: 'acme', slug: 'ops', name: 'Ops' },
    { org: 'acme', slug: 'web', name: 'Web' },
    { org: 'octo', slug: 'docs', name: 'Docs' },
  ],
  error: null,
  ...overrides,
});

export const custom = (overrides: Partial<Section> = {}): Section => ({
  id: 'custom-1',
  kind: 'custom',
  label: 'Bugs',
  enabled: true,
  query: 'label:bug',
  ...overrides,
});
