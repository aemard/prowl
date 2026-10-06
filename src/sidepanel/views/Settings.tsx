import { GearIcon } from '../components/icons';
import { EmptyState } from '../components/ui/EmptyState';

/** The settings screen. US-019 replaces this placeholder. */
export function SettingsView() {
  return (
    <EmptyState
      icon={<GearIcon size={24} />}
      title="Settings"
      description="Nothing to configure yet."
    />
  );
}
