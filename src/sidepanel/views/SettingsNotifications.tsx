import { useId } from 'preact/hooks';
import { t } from '../../lib/i18n';
import type { NotificationSettings } from '../../lib/model';
import { normalizeTime, PR_EVENT_TYPES } from '../../lib/storage/settings';
import { BellIcon } from '../components/icons';
import { Button } from '../components/ui/Button';
import { Switch } from '../components/ui/Switch';
import { TextField } from '../components/ui/TextField';
import { showToast } from '../components/ui/Toast';
import { saveSettings } from '../state/settings';
import { settings } from '../state/store';
import { SettingsGroup } from './SettingsGroup';
import { EVENT_LABELS, quietHoursNote } from './SettingsModel';

/**
 * Shows a notification from the panel itself, with the same icon as the real ones. Its id starts
 * with `test:`, which the worker does not know, so a click only clears it.
 */
async function sendTestNotification(): Promise<void> {
  try {
    await chrome.notifications.create(`test:${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: t('prowlTestNotification'),
      message: t('notificationsFromProwlLookLikeThis'),
    });
    showToast({ message: t('testNotificationSent') });
  } catch {
    showToast({ message: t('couldNotShowANotification'), tone: 'danger' });
  }
}

/** The master switch, one switch per event type, quiet hours and a test button. */
export function NotificationsSettings() {
  const eventsId = useId();
  const { notifications } = settings.value;
  const { enabled, events, quietHours } = notifications;
  const note = quietHours.enabled ? quietHoursNote(quietHours) : null;
  const update = (change: (current: NotificationSettings) => NotificationSettings) =>
    void saveSettings((current) => ({ ...current, notifications: change(current.notifications) }));
  const setTime = (key: 'start' | 'end', value: string) => {
    const time = normalizeTime(value);
    if (time) update((n) => ({ ...n, quietHours: { ...n.quietHours, [key]: time } }));
  };

  return (
    <SettingsGroup title={t('notifications')}>
      <Switch
        label={t('desktopNotifications')}
        description={t('showANotificationWhenAPullRequestChanges')}
        checked={enabled}
        onChange={(next) => update((n) => ({ ...n, enabled: next }))}
      />

      <h4 id={eventsId} class="settings-subtitle">
        {t('notifyMeWhen')}
      </h4>
      <ul class="settings-list" aria-labelledby={eventsId}>
        {PR_EVENT_TYPES.map((type) => (
          <li key={type}>
            <Switch
              label={EVENT_LABELS[type].label}
              description={EVENT_LABELS[type].description}
              checked={events[type]}
              disabled={!enabled}
              onChange={(next) => update((n) => ({ ...n, events: { ...n.events, [type]: next } }))}
            />
          </li>
        ))}
      </ul>

      <Switch
        label={t('quietHours')}
        description={t('silenceNotificationsAtSetTimesEveryDayInYour')}
        checked={quietHours.enabled}
        disabled={!enabled}
        onChange={(next) =>
          update((n) => ({ ...n, quietHours: { ...n.quietHours, enabled: next } }))
        }
      />
      <div class="settings-pair">
        <TextField
          label={t('from')}
          type="time"
          value={quietHours.start}
          disabled={!enabled || !quietHours.enabled}
          onValueChange={(value) => setTime('start', value)}
        />
        <TextField
          label={t('until')}
          type="time"
          value={quietHours.end}
          disabled={!enabled || !quietHours.enabled}
          onValueChange={(value) => setTime('end', value)}
        />
      </div>
      {note && <p class="settings-note">{note}</p>}

      <div class="settings-test">
        <Button icon={<BellIcon />} disabled={!enabled} onClick={() => void sendTestNotification()}>
          {t('sendTestNotification')}
        </Button>
        <p class="settings-note">{t('nothingAppearsCheckThatYourSystemLetsChromeShow')}</p>
      </div>
    </SettingsGroup>
  );
}
