import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../lib/storage/settings';
import { fakeChrome } from '../../test/chrome';
import { buildAuth, buildPollState, buildSnapshot } from '../../test/panel';
import { group, open, saved, toggle } from './Settings.test-support';

describe('SettingsView', () => {
  describe('notifications', () => {
    it('turns every kind of notification on or off on its own', async () => {
      await open({ notifications: { ...defaultSettings().notifications, enabled: true } });
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
      await open({ notifications: { ...defaultSettings().notifications, enabled: true } });
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
      await open({ notifications: { ...defaultSettings().notifications, enabled: true } });
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
      await open({ notifications: { ...defaultSettings().notifications, enabled: true } });
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
      await open({ notifications: { ...defaultSettings().notifications, enabled: true } });
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
      await open({ groupByRepo: false });
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

  describe('section links', () => {
    it('list every group and move focus to the one chosen, leaving the route alone', async () => {
      await open();
      const nav = within(screen.getByRole('navigation', { name: 'Settings sections' }));
      const links = nav.getAllByRole('link');
      expect(links.map((link) => link.textContent)).toEqual([
        'Pull requests',
        'Teams',
        'Refresh',
        'Notifications',
        'Appearance',
        'Account',
        'Privacy',
        'About',
      ]);
      // Every link has its group.
      for (const link of links) {
        expect(document.querySelector(link.getAttribute('href') ?? '-')).toBeTruthy();
      }
      const hash = location.hash;
      fireEvent.click(nav.getByRole('link', { name: 'Privacy' }));
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 3, name: 'Privacy and permissions' }),
      );
      expect(location.hash).toBe(hash);
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

    it('says when the token expires, when GitHub told', async () => {
      await open({}, { ...buildAuth(), expiresAt: null });
      expect(group('Account').getByText('Expires')).toBeTruthy();
      expect(group('Account').getByText('Never')).toBeTruthy();
    });

    it('leaves the expiry out for a sign-in that predates it', async () => {
      await open();
      expect(group('Account').queryByText('Expires')).toBeNull();
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
    it('says when no shortcut opens Prowl', async () => {
      fakeChrome().__state.commands[0] = { name: 'open-panel', shortcut: '' };
      await open();
      await waitFor(() =>
        expect(group('About').getByText(/No keyboard shortcut opens Prowl yet/)).toBeTruthy(),
      );
    });

    it('shows the version and opens the documentation, privacy and source on GitHub', async () => {
      await open();
      const about = group('About');
      expect(about.getByText('Version 0.0.0-test')).toBeTruthy();
      await waitFor(() => expect(about.getByText('Ctrl+Shift+P')).toBeTruthy());

      const links = about.getAllByRole('link');
      expect(links.map((link) => link.textContent)).toEqual([
        'Documentation',
        'Privacy',
        'Source code',
      ]);
      for (const link of links) fireEvent.click(link);
      expect(fakeChrome().__state.createdTabs).toEqual([
        { url: 'https://github.com/aemard/prowl#readme' },
        { url: 'https://github.com/aemard/prowl/blob/main/docs/privacy.md' },
        { url: 'https://github.com/aemard/prowl' },
      ]);
    });
  });
});
