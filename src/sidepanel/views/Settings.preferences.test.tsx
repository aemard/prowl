import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { expect, it, vi } from 'vitest';
import { fakeChrome } from '../../test/chrome';
import { buildAuth, buildPollState, buildSnapshot } from '../../test/panel';
import { group, open, saved, toggle } from './Settings.test-support';

it('SettingsView appearance saves theme, sort order and badge mode', async () => {
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
  await waitFor(() => expect(appearance.getByText(/changes you have not looked at/)).toBeTruthy());
});

it('SettingsView appearance hides pull requests after the number of days without a commit, 0 for never', async () => {
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

it('SettingsView appearance hides drafts and bot PRs with one switch each, off by default', async () => {
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

it('SettingsView appearance groups by repository with its own switch, apart from the sort order', async () => {
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

it('SettingsView appearance offers every value the settings know', async () => {
  await open();
  const options = (label: string) =>
    [...(group('Appearance').getByLabelText(label) as HTMLSelectElement).options].map(
      (o) => o.value,
    );
  expect(options('Theme')).toEqual(['system', 'light', 'dark']);
  expect(options('Sort pull requests by')).toEqual(['updated', 'created', 'repo']);
  expect(options('Toolbar badge')).toEqual(['attention', 'unseen', 'off']);
});

it('SettingsView section links list every group and move focus to the one chosen, leaving the route alone', async () => {
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

it('SettingsView account shows who is signed in, the kind of token and its scopes', async () => {
  await open({}, { ...buildAuth(), scopes: ['repo', 'read:org'] });
  const account = group('Account');
  expect(account.getByText('octocat')).toBeTruthy();
  expect(account.getByText('Classic personal access token')).toBeTruthy();
  expect(account.getByText('repo')).toBeTruthy();
  expect(account.getByText('read:org')).toBeTruthy();
});

it('SettingsView account explains the missing scopes of a fine-grained token', async () => {
  await open({}, { ...buildAuth(), tokenType: 'fine_grained', scopes: [] });
  expect(group('Account').getByText('Fine-grained personal access token')).toBeTruthy();
  expect(group('Account').getByText(/per-repository permissions/)).toBeTruthy();
});

it('SettingsView account says when the token expires, when GitHub told', async () => {
  await open({}, { ...buildAuth(), expiresAt: null });
  expect(group('Account').getByText('Expires')).toBeTruthy();
  expect(group('Account').getByText('Never')).toBeTruthy();
});

it('SettingsView account leaves the expiry out for a sign-in that predates it', async () => {
  await open();
  expect(group('Account').queryByText('Expires')).toBeNull();
});

it('SettingsView account names the other kinds of token', async () => {
  await open({}, { ...buildAuth(), tokenType: 'oauth', scopes: [] });
  expect(group('Account').getByText('OAuth token (signed in with GitHub)')).toBeTruthy();
});

it('SettingsView account signs out after a confirmation and forgets the account', async () => {
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

const names = (scope: ReturnType<typeof group>) =>
  scope.getAllByRole('listitem').map((item) => item.firstElementChild?.textContent);

it('SettingsView privacy and permissions promises that Prowl cannot see the pages, and lists what Chrome lets it do', async () => {
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

it('SettingsView privacy and permissions opens the privacy policy on GitHub', async () => {
  await open();
  fireEvent.click(group('Privacy and permissions').getByRole('link', { name: /privacy policy/ }));
  expect(fakeChrome().__state.createdTabs).toEqual([
    { url: 'https://github.com/aemard/prowl/blob/main/docs/privacy.md' },
  ]);
});

it('SettingsView privacy and permissions lists github.com only while it is granted, and follows Chrome as it changes', async () => {
  await open();
  const privacy = group('Privacy and permissions');
  await waitFor(() => expect(names(privacy)).toHaveLength(5));

  await act(async () => {
    await chrome.permissions.request({ origins: ['https://github.com/*'] });
  });
  await waitFor(() => expect(names(privacy).at(-1)).toBe('github.com'));
  expect(privacy.getByText(/Sign in with GitHub\. Prowl asks for this only while/)).toBeTruthy();

  await act(async () => {
    await chrome.permissions.remove({ origins: ['https://github.com/*'] });
  });
  await waitFor(() => expect(privacy.queryByText('github.com')).toBeNull());
  expect(names(privacy)).toHaveLength(5);
});

it('SettingsView privacy and permissions shows a permission it does not know by name instead of hiding it', async () => {
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

it('SettingsView privacy and permissions stops listening to Chrome when the screen closes', async () => {
  await open();
  const { onAdded, onRemoved } = fakeChrome().permissions;
  expect([onAdded.hasListeners(), onRemoved.hasListeners()]).toEqual([true, true]);
  cleanup();
  expect([onAdded.hasListeners(), onRemoved.hasListeners()]).toEqual([false, false]);
});

it('SettingsView about says when no shortcut opens Prowl', async () => {
  fakeChrome().__state.commands[0] = { name: 'open-panel', shortcut: '' };
  await open();
  await waitFor(() =>
    expect(group('About').getByText(/No keyboard shortcut opens Prowl yet/)).toBeTruthy(),
  );
});

it('SettingsView about shows the version and opens the documentation, privacy and source on GitHub', async () => {
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
