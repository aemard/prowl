import { act, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { expect, it } from 'vitest';
import { defaultSettings } from '../../lib/storage/settings';
import { custom, open, saved } from './Settings.test-support';

const openDialog = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Add custom section' }));
  return within(screen.getByRole('dialog', { name: 'Add custom section' }));
};

const fill = (dialog: ReturnType<typeof openDialog>, name: string, query: string) => {
  fireEvent.input(dialog.getByLabelText('Name'), { target: { value: name } });
  fireEvent.input(dialog.getByLabelText('Search query'), { target: { value: query } });
};

it('SettingsView custom section dialog adds an enabled section with a trimmed name and query', async () => {
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

it('SettingsView custom section dialog explains what is wrong and focuses the first field to fix', async () => {
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

it('SettingsView custom section dialog rejects queries GitHub would answer with an error', async () => {
  await open();
  const dialog = openDialog();
  fill(dialog, 'Either', 'author:a OR author:b');
  expect(dialog.getByText(/only work between search words/)).toBeTruthy();
});

it('SettingsView custom section dialog edits an existing section in place and keeps it where it is', async () => {
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

it('SettingsView custom section dialog leaves everything alone on cancel', async () => {
  await open();
  const dialog = openDialog();
  fill(dialog, 'Bugs', 'label:bug');
  fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect((await saved()).sections).toHaveLength(5);
});

it('SettingsView custom section dialog removes a section and puts it back where it was on undo', async () => {
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
