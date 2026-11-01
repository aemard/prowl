import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../lib/storage/settings';
import { fakeChrome } from '../../test/chrome';
import { buildAuth } from '../../test/panel';
import { custom, group, open, saved, stop, teamsState, toggle } from './Settings.test-support';

describe('SettingsView', () => {
  it("has a title and one heading per group, in the order of the user's questions", async () => {
    await open();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Settings');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Pull requests',
      'Teams',
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
      expect(
        scope.getByText(
          'Pull requests that ask you for a review (your teams have their own section)',
        ),
      ).toBeTruthy();
      expect(toggle('Team reviews', scope).getAttribute('aria-checked')).toBe('false');
      expect(scope.getByText('Pull requests that ask one of your teams for a review')).toBeTruthy();

      fireEvent.click(toggle('Review requested', scope));
      await waitFor(() =>
        expect(toggle('Review requested', scope).getAttribute('aria-checked')).toBe('true'),
      );
      expect((await saved()).sections.map((s) => [s.id, s.enabled])).toEqual([
        ['authored', true],
        ['review_requested', true],
        ['team_review_requested', false],
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
      expect((await saved()).sections).toHaveLength(5);
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
      expect((await saved()).sections).toHaveLength(5);
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
          'team_review_requested',
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
      expect(refresh.getByText(/about 48 points an hour/)).toBeTruthy();
      expect(refresh.getByText(/5,000 points an hour/)).toBeTruthy();

      fireEvent.input(refresh.getByLabelText('Check every (minutes)'), { target: { value: '2' } });
      await waitFor(async () => expect((await saved()).pollIntervalMinutes).toBe(2));
      expect(refresh.getByText(/about 120 points an hour/)).toBeTruthy();
    });

    it('does not accept less than two minutes', async () => {
      await open();
      const field = group('Refresh').getByLabelText('Check every (minutes)');
      fireEvent.input(field, { target: { value: '1' } });
      expect(screen.getByText('Enter a whole number from 2 to 60.')).toBeTruthy();
      expect((await saved()).pollIntervalMinutes).toBe(5);
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
        pollIntervalMinutes: 2,
      });
      // Four presets at 240 points an hour; Team reviews searches nothing without a team.
      expect(group('Refresh').getByText(/about 960 points an hour/)).toBeTruthy();
    });

    it('counts a search per followed team', async () => {
      await open(
        {
          sections: defaultSettings().sections.map((s) => ({ ...s, enabled: true })),
          maxPerSection: 100,
          pollIntervalMinutes: 2,
          unfollowedTeams: ['acme/ops'],
        },
        buildAuth(),
        { teams: teamsState() },
      );
      expect(group('Refresh').getByText(/about 1,440 points an hour/)).toBeTruthy();
    });
  });

  describe('teams', () => {
    it('lists the teams by organization and follows or unfollows each one', async () => {
      await open({}, buildAuth(), { teams: teamsState() });
      const teams = group('Teams');
      expect(
        teams.getAllByRole('group').map((g) => g.querySelector('legend')?.textContent),
      ).toEqual(['acme', 'octo']);
      expect(toggle('Web', teams).getAttribute('aria-checked')).toBe('true');
      fireEvent.click(toggle('Ops', teams));
      await waitFor(async () => expect((await saved()).unfollowedTeams).toEqual(['acme/ops']));
      fireEvent.click(toggle('Ops', teams));
      await waitFor(async () => expect((await saved()).unfollowedTeams).toEqual([]));
    });

    it('says when Team reviews is off, and refreshes the list on demand', async () => {
      const send = vi.spyOn(chrome.runtime, 'sendMessage');
      await open({}, buildAuth(), { teams: teamsState() });
      const teams = group('Teams');
      expect(teams.getByText(/Turn on Team reviews under Sections/)).toBeTruthy();
      fireEvent.click(teams.getByRole('button', { name: 'Refresh teams' }));
      await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'refreshTeams' }));
    });

    it('explains a token that cannot list teams and offers to sign in again', async () => {
      await open({}, buildAuth(), {
        teams: teamsState({
          teams: [],
          error: { kind: 'missing_scope', message: 'GitHub would not list your teams.' },
        }),
      });
      const teams = group('Teams');
      expect(teams.getByText('GitHub would not list your teams.')).toBeTruthy();
      fireEvent.click(teams.getByRole('button', { name: 'Sign in again' }));
      expect(location.hash).toBe('#/onboarding');
    });

    it('says when GitHub lists no team, and when it has not looked yet', async () => {
      await open({}, buildAuth(), { teams: teamsState({ teams: [] }) });
      expect(group('Teams').getByText('GitHub lists no team for your account.')).toBeTruthy();
      cleanup();
      stop?.();
      await chrome.storage.local.remove('teams');
      await open();
      expect(group('Teams').getByText('Not checked yet')).toBeTruthy();
    });

    it('warns when more teams are followed than Prowl searches', async () => {
      const many = Array.from({ length: 12 }, (_, i) => ({
        org: 'acme',
        slug: `t${i}`,
        name: `T${i}`,
      }));
      await open({}, buildAuth(), { teams: teamsState({ teams: many }) });
      expect(
        group('Teams').getByText(/You follow 12 teams; Prowl searches the first 10/),
      ).toBeTruthy();
    });
  });

  describe('settings sync', () => {
    it('turns syncing on for this device only, and shows why Chrome sync refused', async () => {
      await open();
      const privacy = group('Privacy and permissions');
      const toggle = privacy.getByRole('switch', {
        name: 'Sync settings with your Chrome profile',
      });
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      fireEvent.click(toggle);
      await waitFor(async () =>
        expect((await chrome.storage.local.get('sync')).sync).toEqual({
          enabled: true,
          error: null,
        }),
      );
      await act(async () => {
        await chrome.storage.local.set({
          sync: { enabled: true, error: 'Too big for Chrome sync.' },
        });
      });
      expect(privacy.getByRole('status').textContent).toBe('Too big for Chrome sync.');
    });
  });
});
