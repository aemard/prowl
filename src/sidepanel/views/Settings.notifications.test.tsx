import { act, fireEvent, screen, waitFor } from '@testing-library/preact';
import { expect, it, vi } from 'vitest';
import { defaultSettings } from '../../lib/storage/settings';
import { fakeChrome } from '../../test/chrome';
import { group, open, saved, toggle } from './Settings.test-support';

it('SettingsView notifications turns every kind of notification on or off on its own', async () => {
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

it('SettingsView notifications greys out what depends on the master switch', async () => {
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

it('SettingsView notifications sets quiet hours that cross midnight', async () => {
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

it('SettingsView notifications ignores a time that is not complete', async () => {
  await open({
    notifications: {
      ...defaultSettings().notifications,
      quietHours: { enabled: true, start: '22:00', end: '08:00' },
    },
  });
  fireEvent.input(group('Notifications').getByLabelText('From'), { target: { value: '' } });
  expect((await saved()).notifications.quietHours.start).toBe('22:00');
});

it('SettingsView notifications shows a test notification with the Prowl icon and says so', async () => {
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

it('SettingsView notifications says when Chrome could not show it', async () => {
  await open({ notifications: { ...defaultSettings().notifications, enabled: true } });
  vi.spyOn(chrome.notifications, 'create').mockRejectedValue(new Error('denied'));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send test notification' }));
  });
  expect(screen.getByText('Could not show a notification.')).toBeTruthy();
});
