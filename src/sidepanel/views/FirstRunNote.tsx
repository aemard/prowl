import { dismissFirstRun } from '../../lib/storage/onboarding';
import { Button } from '../components/ui/Button';
import { navigate } from '../state/router';
import { saveSettings } from '../state/settings';
import { auth, onboarding, settings, teams } from '../state/store';
import './FirstRunNote.css';

async function dismissNote() {
  const active = document.activeElement;
  if (active?.closest('.first-run-note')) active.closest('main')?.focus();
  await dismissFirstRun();
}

async function enableNotifications() {
  if (
    await saveSettings((current) => ({
      ...current,
      notifications: { ...current.notifications, enabled: true },
    }))
  )
    await dismissNote();
}

export function FirstRunNote() {
  if (onboarding.value?.status !== 'pending') return null;
  const count =
    teams.value?.login === auth.value?.viewer.login ? (teams.value?.teams.length ?? 0) : 0;
  return (
    <div class="list__notice first-run-note" role="status">
      <div class="first-run-note__body">
        <p>
          Following pull requests you opened and reviews asked of you. Notifications are{' '}
          {settings.value.notifications.enabled ? 'on' : 'off'}.
        </p>
        <div class="first-run-note__actions">
          <Button size="sm" onClick={() => void enableNotifications()}>
            Turn on notifications
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('settings')}>
            Settings
          </Button>
          <Button size="sm" variant="ghost" aria-label="Got it" onClick={() => void dismissNote()}>
            Got it
          </Button>
        </div>
        {count > 0 && (
          <p>
            You're in {count} {count === 1 ? 'team' : 'teams'} ·{' '}
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void saveSettings(
                  (current) => ({
                    ...current,
                    sections: current.sections.map((section) =>
                      section.kind === 'team_review_requested'
                        ? { ...section, enabled: true }
                        : section,
                    ),
                  }),
                  { refresh: true },
                )
              }
            >
              Show Team reviews
            </Button>
          </p>
        )}
      </div>
    </div>
  );
}
