import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthState, Section, Settings } from '../../lib/model';
import { defaultSettings, normalizeSettings } from '../../lib/storage/settings';
import { fakeChrome } from '../../test/chrome';
import { buildAuth, buildPollState, buildSnapshot } from '../../test/panel';
import { ToastRegion, toasts } from '../components/ui/Toast';
import { auth, hydrateStore } from '../state/store';
import { SettingsView } from './Settings';

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  auth.value = undefined;
  toasts.value = [];
  location.hash = '';
});

/** Stores `settings` (and the account), loads the panel's store from it and renders the screen. */
async function open(settings: Partial<Settings> = {}, account: AuthState | null = buildAuth()) {
  await chrome.storage.local.set({
    settings: { ...defaultSettings(), ...settings },
    ...(account ? { auth: account } : {}),
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

const saved = async () => normalizeSettings((await chrome.storage.local.get('settings')).settings);
const group = (title: string) =>
  within(screen.getByRole('heading', { level: 3, name: title }).closest('section') as HTMLElement);
const toggle = (name: string, scope: Pick<typeof screen, 'getByRole'> = screen) =>
  scope.getByRole('switch', { name });
const custom = (overrides: Partial<Section> = {}): Section => ({
  id: 'custom-1',
  kind: 'custom',
  label: 'Bugs',
  enabled: true,
  query: 'label:bug',
  ...overrides,
});

describe('SettingsView', () => {
  it("has a title and one heading per group, in the order of the user's questions", async () => {
    await open();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Settings');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Pull requests',
      'Refresh',
      'Notifications',
      'Appearance',
      'Account',
      'Privacy and permissions',
      'About',
    ]);
  });

  describe('sections', () => {
    it('shows each preset with what it follows, and turns it on or off', async () => {
      await open();
      const scope = group('Pull requests');
      expect(toggle('Created by me', scope).getAttribute('aria-checked')).toBe('true');
      expect(toggle('Review requested', scope).getAttribute('aria-checked')).toBe('false');
      expect(scope.getByText('Pull requests waiting for your review')).toBeTruthy();

      fireEvent.click(toggle('Review requested', scope));
      await waitFor(() =>
        expect(toggle('Review requested', scope).getAttribute('aria-checked')).toBe('true'),
      );
      expect((await saved()).sections.map((s) => [s.id, s.enabled])).toEqual([
        ['authored', true],
        ['review_requested', true],
        ['mentioned', false],
        ['assigned', false],
      ]);
    });

    it('asks the worker to refresh the list once the changes stop', async () => {
      await open();
      const send = vi.spyOn(fakeChrome().runtime, 'sendMessage');
      fireEvent.click(toggle('Mentioned'));
      fireEvent.click(toggle('Assigned to me'));
      await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'poll', force: true }), {
        timeout: 2000,
      });
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('lists custom sections with their query, edit and remove', async () => {
      await open({ sections: [...defaultSettings().sections, custom()] });
      expect(screen.getByRole('switch', { name: 'Bugs' })).toBeTruthy();
      expect(screen.getByText('label:bug')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Edit Bugs' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Remove Bugs' })).toBeTruthy();
    });
  });

  describe('custom section dialog', () => {
    const openDialog = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add custom section' }));
      return within(screen.getByRole('dialog', { name: 'Add custom section' }));
    };
    const fill = (dialog: ReturnType<typeof openDialog>, name: string, query: string) => {
      fireEvent.input(dialog.getByLabelText('Name'), { target: { value: name } });
      fireEvent.input(dialog.getByLabelText('Search query'), { target: { value: query } });
    };

    it('adds an enabled section with a trimmed name and query', async () => {
      await open();
      const dialog = openDialog();
      fill(dialog, '  Bugs  ', ' label:bug review-requested:@me ');
      await act(async () => {
        fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
      });

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const added = (await saved()).sections.at(-1);
      expect(added).toMatchObject({
        kind: 'custom',
        label: 'Bugs',
        query: 'label:bug review-requested:@me',
        enabled: true,
      });
      expect(added?.id).toMatch(/^custom-[0-9a-f]{8}$/);
      await waitFor(() => expect(screen.getByRole('switch', { name: 'Bugs' })).toBeTruthy());
    });

    it('explains what is wrong and focuses the first field to fix', async () => {
      await open();
      const dialog = openDialog();
      fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
      expect(dialog.getByText('Give the section a name.')).toBeTruthy();
      expect(dialog.getByText(/Enter a GitHub search query/)).toBeTruthy();
      expect(document.activeElement).toBe(dialog.getByLabelText('Name'));

      fill(dialog, 'Issues', 'is:issue label:bug');
      expect(dialog.getByText(/follows pull requests only/)).toBeTruthy();
      fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
      expect(document.activeElement).toBe(dialog.getByLabelText('Search query'));
      expect((await saved()).sections).toHaveLength(4);
    });

    it('rejects queries GitHub would answer with an error', async () => {
      await open();
      const dialog = openDialog();
      fill(dialog, 'Either', 'author:a OR author:b');
      expect(dialog.getByText(/only work between search words/)).toBeTruthy();
    });

    it('edits an existing section in place and keeps it where it is', async () => {
      await open({ sections: [...defaultSettings().sections, custom({ enabled: false })] });
      fireEvent.click(screen.getByRole('button', { name: 'Edit Bugs' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Edit custom section' }));
      expect((dialog.getByLabelText('Name') as HTMLInputElement).value).toBe('Bugs');
      fill(dialog, 'Crashes', 'label:crash');
      await act(async () => {
        fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
      });

      await waitFor(async () =>
        expect((await saved()).sections.at(-1)).toMatchObject({
          id: 'custom-1',
          label: 'Crashes',
          query: 'label:crash',
          enabled: false,
        }),
      );
    });

    it('leaves everything alone on cancel', async () => {
      await open();
      const dialog = openDialog();
      fill(dialog, 'Bugs', 'label:bug');
      fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect((await saved()).sections).toHaveLength(4);
    });

    it('removes a section and puts it back where it was on undo', async () => {
      const bugs = custom();
      await open({
        sections: [
          ...defaultSettings().sections.slice(0, 2),
          bugs,
          ...defaultSettings().sections.slice(2),
        ],
      });
      fireEvent.click(screen.getByRole('button', { name: 'Remove Bugs' }));
      await waitFor(async () =>
        expect((await saved()).sections.map((s) => s.id)).not.toContain('custom-1'),
      );
      expect(screen.queryByRole('switch', { name: 'Bugs' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(async () =>
        expect((await saved()).sections.map((s) => s.id)).toEqual([
          'authored',
          'review_requested',
          'custom-1',
          'mentioned',
          'assigned',
        ]),
      );
    });
  });

  describe('repositories', () => {
    it('adds and removes include and exclude patterns', async () => {
      await open({ repoExclude: ['acme/legacy'] });
      const include = within(screen.getByRole('group', { name: 'Include' }));
      fireEvent.input(include.getByLabelText('Include repository'), {
        target: { value: 'acme' },
      });
      await act(async () => {
        fireEvent.click(include.getByRole('button', { name: 'Add to include list' }));
      });
      await waitFor(async () => expect((await saved()).repoInclude).toEqual(['acme']));

      fireEvent.click(screen.getByRole('button', { name: 'Remove acme/legacy' }));
      await waitFor(async () => expect((await saved()).repoExclude).toEqual([]));
    });

    it('keeps every pattern added before the previous save came back', async () => {
      await open();
      const include = within(screen.getByRole('group', { name: 'Include' }));
      // Two quick additions, like typing fast: the list on screen has not caught up in between.
      for (const text of ['acme', 'octo/docs']) {
        act(() => {
          fireEvent.input(include.getByLabelText('Include repository'), {
            target: { value: text },
          });
        });
        act(() => {
          fireEvent.click(include.getByRole('button', { name: 'Add to include list' }));
        });
      }
      await waitFor(async () => expect((await saved()).repoInclude).toEqual(['acme', 'octo/docs']));
    });
  });

  describe('refresh', () => {
    it('saves a new interval and explains what polling costs', async () => {
      await open();
      const refresh = group('Refresh');
      expect(refresh.getByText(/about 120 points an hour/)).toBeTruthy();
      expect(refresh.getByText(/5,000 points an hour/)).toBeTruthy();

      fireEvent.input(refresh.getByLabelText('Check every (minutes)'), { target: { value: '1' } });
      await waitFor(async () => expect((await saved()).pollIntervalMinutes).toBe(1));
      expect(refresh.getByText(/about 240 points an hour/)).toBeTruthy();
    });

    it('does not accept less than one minute', async () => {
      await open();
      const field = group('Refresh').getByLabelText('Check every (minutes)');
      fireEvent.input(field, { target: { value: '0' } });
      expect(screen.getByText('Enter a whole number from 1 to 60.')).toBeTruthy();
      expect((await saved()).pollIntervalMinutes).toBe(2);
    });

    it('saves how many pull requests to fetch per section', async () => {
      await open();
      fireEvent.input(group('Refresh').getByLabelText('Pull requests per section'), {
        target: { value: '100' },
      });
      await waitFor(async () => expect((await saved()).maxPerSection).toBe(100));
    });

    it('counts only the sections that are on', async () => {
      await open({
        sections: defaultSettings().sections.map((s) => ({ ...s, enabled: true })),
        maxPerSection: 100,
        pollIntervalMinutes: 1,
      });
      expect(group('Refresh').getByText(/about 1,920 points an hour/)).toBeTruthy();
    });
  });

  describe('notifications', () => {
    it('turns every kind of notification on or off on its own', async () => {
      await open();
      const notifications = group('Notifications');
      fireEvent.click(toggle('CI passes', notifications));
      fireEvent.click(toggle('Merged', notifications));
      await waitFor(async () => {
        const { events } = (await saved()).notifications;
        expect(events.ci_passed).toBe(false);
        expect(events.merged).toBe(false);
        expect(events.ci_failed).toBe(true);
      });
      expect(notifications.getAllByRole('switch')).toHaveLength(1 + 9 + 1);
    });

    it('greys out what depends on the master switch', async () => {
      await open();
      const notifications = group('Notifications');
      fireEvent.click(toggle('Desktop notifications', notifications));
      await waitFor(() =>
        expect((toggle('CI fails', notifications) as HTMLButtonElement).disabled).toBe(true),
      );
      expect((toggle('Quiet hours', notifications) as HTMLButtonElement).disabled).toBe(true);
      expect(
        (notifications.getByRole('button', { name: 'Send test notification' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect((await saved()).notifications.enabled).toBe(false);
    });

    it('sets quiet hours that cross midnight', async () => {
      await open();
      const notifications = group('Notifications');
      expect((notifications.getByLabelText('From') as HTMLInputElement).disabled).toBe(true);

      fireEvent.click(toggle('Quiet hours', notifications));
      await waitFor(() =>
        expect((notifications.getByLabelText('From') as HTMLInputElement).disabled).toBe(false),
      );
      expect(notifications.getByText(/crosses midnight/)).toBeTruthy();

      fireEvent.input(notifications.getByLabelText('From'), { target: { value: '23:30' } });
      fireEvent.input(notifications.getByLabelText('Until'), { target: { value: '06:15' } });
      await waitFor(async () =>
        expect((await saved()).notifications.quietHours).toEqual({
          enabled: true,
          start: '23:30',
          end: '06:15',
        }),
      );
      fireEvent.input(notifications.getByLabelText('Until'), { target: { value: '23:45' } });
      await waitFor(() => expect(notifications.queryByText(/crosses midnight/)).toBeNull());
    });

    it('ignores a time that is not complete', async () => {
      await open({
        notifications: {
          ...defaultSettings().notifications,
          quietHours: { enabled: true, start: '22:00', end: '08:00' },
        },
      });
      fireEvent.input(group('Notifications').getByLabelText('From'), { target: { value: '' } });
      expect((await saved()).notifications.quietHours.start).toBe('22:00');
    });

    it('shows a test notification with the Prowl icon and says so', async () => {
      await open();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Send test notification' }));
      });
      const [shown] = [...fakeChrome().__state.notifications.values()];
      expect(shown?.id).toMatch(/^test:\d+$/);
      expect(shown?.options).toMatchObject({
        type: 'basic',
        title: 'Prowl test notification',
        iconUrl: 'chrome-extension://prowl-test-extension/icons/icon-128.png',
      });
      expect(screen.getByText('Test notification sent.')).toBeTruthy();
    });

    it('says when Chrome could not show it', async () => {
      await open();
      vi.spyOn(chrome.notifications, 'create').mockRejectedValue(new Error('denied'));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Send test notification' }));
      });
      expect(screen.getByText('Could not show a notification.')).toBeTruthy();
    });
  });

  describe('appearance', () => {
    it('saves theme, sort order and badge mode', async () => {
      await open();
      const appearance = group('Appearance');
      fireEvent.change(appearance.getByLabelText('Theme'), { target: { value: 'dark' } });
      fireEvent.change(appearance.getByLabelText('Sort pull requests by'), {
        target: { value: 'repo' },
      });
      fireEvent.change(appearance.getByLabelText('Toolbar badge'), { target: { value: 'unseen' } });
      await waitFor(async () =>
        expect(await saved()).toMatchObject({ theme: 'dark', sort: 'repo', badge: 'unseen' }),
      );
      await waitFor(() =>
        expect(appearance.getByText(/changes you have not looked at/)).toBeTruthy(),
      );
    });

    it('hides pull requests after the number of days without a commit, 0 for never', async () => {
      await open();
      const field = group('Appearance').getByLabelText('Hide PRs with no commit for (days)');
      expect((field as HTMLInputElement).value).toBe('20');
      expect(group('Appearance').getByText(/still notify you\. 0 never hides\./)).toBeTruthy();

      fireEvent.input(field, { target: { value: '366' } });
      expect(screen.getByText('Enter a whole number from 0 to 365.')).toBeTruthy();
      expect((await saved()).hideStaleAfterDays).toBe(20);
      fireEvent.input(field, { target: { value: '0' } });
      await waitFor(async () => expect((await saved()).hideStaleAfterDays).toBe(0));
    });

    it('hides drafts and bot PRs with one switch each, off by default', async () => {
      await open();
      const appearance = group('Appearance');
      const drafts = toggle('Hide draft PRs', appearance);
      const bots = toggle('Hide PRs opened by bots', appearance);
      expect(drafts.getAttribute('aria-checked')).toBe('false');
      expect(bots.getAttribute('aria-checked')).toBe('false');
      expect(bots.getAttribute('aria-describedby')).toBeTruthy();
      expect(appearance.getByText(/Dependabot, Renovate and other apps/)).toBeTruthy();

      fireEvent.click(drafts);
      await waitFor(async () => expect(await saved()).toMatchObject({ hideDrafts: true }));
      expect((await saved()).hideBots).toBe(false);
      fireEvent.click(bots);
      await waitFor(async () => expect(await saved()).toMatchObject({ hideBots: true }));
      expect(drafts.getAttribute('aria-checked')).toBe('true');
      fireEvent.click(drafts);
      await waitFor(async () => expect(await saved()).toMatchObject({ hideDrafts: false }));
    });

    it('groups by repository with its own switch, apart from the sort order', async () => {
      await open();
      const appearance = group('Appearance');
      const grouping = toggle('Group pull requests by repository', appearance);
      expect(grouping.getAttribute('aria-checked')).toBe('false');
      expect(grouping.getAttribute('aria-describedby')).toBeTruthy();

      fireEvent.click(grouping);
      await waitFor(async () => expect(await saved()).toMatchObject({ groupByRepo: true }));
      expect((await saved()).sort).toBe('updated');
      fireEvent.change(appearance.getByLabelText('Sort pull requests by'), {
        target: { value: 'repo' },
      });
      await waitFor(async () => expect(await saved()).toMatchObject({ sort: 'repo' }));
      expect((await saved()).groupByRepo).toBe(true);
      fireEvent.click(grouping);
      await waitFor(async () => expect(await saved()).toMatchObject({ groupByRepo: false }));
    });

    it('offers every value the settings know', async () => {
      await open();
      const options = (label: string) =>
        [...(group('Appearance').getByLabelText(label) as HTMLSelectElement).options].map(
          (o) => o.value,
        );
      expect(options('Theme')).toEqual(['system', 'light', 'dark']);
      expect(options('Sort pull requests by')).toEqual(['updated', 'created', 'repo']);
      expect(options('Toolbar badge')).toEqual(['attention', 'unseen', 'off']);
    });
  });

  describe('account', () => {
    it('shows who is signed in, the kind of token and its scopes', async () => {
      await open({}, { ...buildAuth(), scopes: ['repo', 'read:org'] });
      const account = group('Account');
      expect(account.getByText('octocat')).toBeTruthy();
      expect(account.getByText('Classic personal access token')).toBeTruthy();
      expect(account.getByText('repo')).toBeTruthy();
      expect(account.getByText('read:org')).toBeTruthy();
    });

    it('explains the missing scopes of a fine-grained token', async () => {
      await open({}, { ...buildAuth(), tokenType: 'fine_grained', scopes: [] });
      expect(group('Account').getByText('Fine-grained personal access token')).toBeTruthy();
      expect(group('Account').getByText(/per-repository permissions/)).toBeTruthy();
    });

    it('names the other kinds of token', async () => {
      await open({}, { ...buildAuth(), tokenType: 'oauth', scopes: [] });
      expect(group('Account').getByText('OAuth token (signed in with GitHub)')).toBeTruthy();
    });

    it('signs out after a confirmation and forgets the account', async () => {
      await open();
      await chrome.storage.local.set({ snapshot: buildSnapshot(), pollState: buildPollState() });
      const send = vi.spyOn(fakeChrome().runtime, 'sendMessage');
      fireEvent.click(group('Account').getByRole('button', { name: 'Sign out' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Sign out?' }));
      expect(send).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(dialog.getByRole('button', { name: 'Sign out' }));
      });
      expect(send).toHaveBeenCalledWith({ type: 'signedOut' });
      expect(Object.keys(await chrome.storage.local.get(null))).toEqual(['settings']);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('privacy and permissions', () => {
    const names = (scope: ReturnType<typeof group>) =>
      scope.getAllByRole('listitem').map((item) => item.firstElementChild?.textContent);

    it('promises that Prowl cannot see the pages, and lists what Chrome lets it do', async () => {
      await open();
      const privacy = group('Privacy and permissions');
      expect(
        privacy.getByText(
          'Prowl cannot see or change the pages you visit: it has no access to your tabs or their content.',
        ),
      ).toBeTruthy();
      await waitFor(() =>
        expect(names(privacy)).toEqual([
          'Side panel',
          'Storage',
          'Alarms',
          'Notifications',
          'api.github.com',
        ]),
      );
      const list = privacy.getByRole('list', { name: 'What Prowl may do' });
      expect(within(list).getByText(/Read your pull requests and act on them/)).toBeTruthy();
      // The optional github.com host is not there until it is granted.
      expect(privacy.queryByText('github.com')).toBeNull();
    });

    it('opens the privacy policy on GitHub', async () => {
      await open();
      fireEvent.click(
        group('Privacy and permissions').getByRole('link', { name: /privacy policy/ }),
      );
      expect(fakeChrome().__state.createdTabs).toEqual([
        { url: 'https://github.com/aemard/prowl/blob/main/docs/privacy.md' },
      ]);
    });

    it('lists github.com only while it is granted, and follows Chrome as it changes', async () => {
      await open();
      const privacy = group('Privacy and permissions');
      await waitFor(() => expect(names(privacy)).toHaveLength(5));

      await act(async () => {
        await chrome.permissions.request({ origins: ['https://github.com/*'] });
      });
      await waitFor(() => expect(names(privacy).at(-1)).toBe('github.com'));
      expect(
        privacy.getByText(/Sign in with GitHub\. Prowl asks for this only while/),
      ).toBeTruthy();

      await act(async () => {
        await chrome.permissions.remove({ origins: ['https://github.com/*'] });
      });
      await waitFor(() => expect(privacy.queryByText('github.com')).toBeNull());
      expect(names(privacy)).toHaveLength(5);
    });

    it('shows a permission it does not know by name instead of hiding it', async () => {
      await open();
      const privacy = group('Privacy and permissions');
      await waitFor(() => expect(names(privacy)).toHaveLength(5));
      vi.spyOn(fakeChrome().permissions, 'getAll').mockResolvedValue({
        permissions: ['storage', 'tabs'],
        origins: [],
      });
      await act(async () => {
        fakeChrome().permissions.onAdded.emit({ permissions: ['tabs'] });
      });
      await waitFor(() => expect(names(privacy)).toEqual(['Storage', 'tabs']));
      expect(privacy.getByText('Not described by this version of Prowl.')).toBeTruthy();
    });

    it('stops listening to Chrome when the screen closes', async () => {
      await open();
      const { onAdded, onRemoved } = fakeChrome().permissions;
      expect([onAdded.hasListeners(), onRemoved.hasListeners()]).toEqual([true, true]);
      cleanup();
      expect([onAdded.hasListeners(), onRemoved.hasListeners()]).toEqual([false, false]);
    });
  });

  describe('about', () => {
    it('shows the version and opens the documentation, privacy and source on GitHub', async () => {
      await open();
      const about = group('About');
      expect(about.getByText('Version 0.0.0-test')).toBeTruthy();

      const links = about.getAllByRole('link');
      expect(links.map((link) => link.textContent)).toEqual([
        'Documentation',
        'Privacy',
        'Source code',
      ]);
      for (const link of links) fireEvent.click(link);
      expect(fakeChrome().__state.createdTabs).toEqual([
        { url: 'https://github.com/aemard/prowl/tree/main/docs' },
        { url: 'https://github.com/aemard/prowl/blob/main/docs/privacy.md' },
        { url: 'https://github.com/aemard/prowl' },
      ]);
    });
  });
});
