import { Switch } from '../components/ui/Switch';
import { PRESET_DESCRIPTIONS } from './SettingsModel';
import { SetupTeams } from './SetupTeams';
import type { Preset, useSetupWizard } from './useSetupWizard';

const PRESETS: { kind: Preset; label: string }[] = [
  { kind: 'authored', label: 'Created by me' },
  { kind: 'review_requested', label: 'Review requested' },
  { kind: 'team_review_requested', label: 'Team reviews' },
  { kind: 'mentioned', label: 'Mentioned' },
  { kind: 'assigned', label: 'Assigned to me' },
];

export function SetupCategories({
  selected,
  toggle,
  unfollowed,
  followTeam,
}: ReturnType<typeof useSetupWizard>) {
  return (
    <div class="setup__content">
      <p class="setup__description">
        Choose which pull requests Prowl follows. You can change these anytime in Settings.
      </p>
      <div class="setup__choices">
        {PRESETS.map(({ kind, label }) => (
          <Switch
            key={kind}
            label={label}
            description={PRESET_DESCRIPTIONS[kind]}
            checked={selected.includes(kind)}
            onChange={(value) => toggle(kind, value)}
          />
        ))}
      </div>
      {selected.includes('team_review_requested') && (
        <SetupTeams unfollowed={unfollowed} followTeam={followTeam} />
      )}
      {selected.length === 0 && (
        <p class="setup__hint" role="status">
          Select at least one category to continue, or skip setup.
        </p>
      )}
    </div>
  );
}
