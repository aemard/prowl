import { Switch } from '../components/ui/Switch';
import type { useSetupWizard } from './useSetupWizard';

export function SetupSummary({
  notifications,
  setNotifications,
}: ReturnType<typeof useSetupWizard>) {
  return (
    <div class="setup__content">
      <p class="setup__description">
        Decide whether Prowl should notify you when a pull request changes.
      </p>
      <div class="setup__choices">
        <Switch label="Desktop notifications" checked={notifications} onChange={setNotifications} />
      </div>
      <p class="setup__hint">You can choose events and quiet hours later in Settings.</p>
    </div>
  );
}
