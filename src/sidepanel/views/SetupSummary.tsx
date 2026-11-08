import { Switch } from '../components/ui/Switch';
import type { useSetupWizard } from './useSetupWizard';
export function SetupSummary({
  step,
  notifications,
  setNotifications,
}: ReturnType<typeof useSetupWizard>) {
  return (
    <>
      {step === 1 && (
        <div class="setup__content">
          <p class="setup__description">
            Decide whether Prowl should notify you when a pull request changes.
          </p>
          <div class="setup__choices">
            <Switch
              label="Desktop notifications"
              description="CI failures, reviews, comments, approvals and merge status."
              checked={notifications}
              onChange={setNotifications}
            />
          </div>
          <p class="setup__hint">
            Notifications stay off unless you enable them. You can customize events and quiet hours
            later in Settings.
          </p>
        </div>
      )}
      {step === 2 && (
        <div class="setup__content setup__done">
          <p class="setup__description">Prowl is ready to keep an eye on your pull requests.</p>
          <ul class="setup__tips">
            <li>
              <strong>Track your PRs.</strong> See CI, reviews and merge readiness at a glance.
            </li>
            <li>
              <strong>Take action.</strong> Review, approve and merge right from the side panel.
            </li>
            <li>
              <strong>Open anywhere.</strong> Use the Prowl keyboard shortcut.
            </li>
          </ul>
        </div>
      )}
    </>
  );
}
