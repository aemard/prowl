import type { BadgeMode, SortOrder, Theme } from '../../lib/model';
import {
  MAX_PER_SECTION,
  MAX_POLL_INTERVAL_MINUTES,
  MIN_PER_SECTION,
  MIN_POLL_INTERVAL_MINUTES,
} from '../../lib/storage/settings';
import { NumberField } from '../components/NumberField';
import { Select, type SelectOption } from '../components/ui/Select';
import { saveSettings } from '../state/settings';
import { settings } from '../state/store';
import { AboutSettings, AccountSettings } from './SettingsAccount';
import { SettingsGroup } from './SettingsGroup';
import { BADGE_HINTS, estimatedPointsPerHour, HOURLY_POINTS } from './SettingsModel';
import { NotificationsSettings } from './SettingsNotifications';
import { PrivacySettings } from './SettingsPrivacy';
import { ScopeSettings } from './SettingsScope';

const THEMES: SelectOption<Theme>[] = [
  { value: 'system', label: 'Match system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const SORTS: SelectOption<SortOrder>[] = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Newest first' },
  { value: 'repo', label: 'Repository' },
];

const BADGES: SelectOption<BadgeMode>[] = [
  { value: 'attention', label: 'Needs attention' },
  { value: 'unseen', label: 'Unseen changes' },
  { value: 'off', label: 'Off' },
];

/** How often Prowl asks GitHub, and what that costs of the hourly rate limit. */
function PollingSettings() {
  const { pollIntervalMinutes, maxPerSection, sections } = settings.value;
  const followed = sections.filter((section) => section.enabled).length;
  const points = estimatedPointsPerHour(followed, maxPerSection, pollIntervalMinutes);
  return (
    <SettingsGroup title="Refresh">
      <div class="settings-pair">
        <NumberField
          label="Check every (minutes)"
          value={pollIntervalMinutes}
          min={MIN_POLL_INTERVAL_MINUTES}
          max={MAX_POLL_INTERVAL_MINUTES}
          onCommit={(value) => void saveSettings({ pollIntervalMinutes: value })}
        />
        <NumberField
          label="Pull requests per section"
          value={maxPerSection}
          min={MIN_PER_SECTION}
          max={MAX_PER_SECTION}
          onCommit={(value) => void saveSettings({ maxPerSection: value }, { refresh: true })}
        />
      </div>
      <p class="settings-note">
        GitHub gives each token {HOURLY_POINTS.toLocaleString('en-US')} points an hour, and every
        check of every section spends some: more pull requests and shorter intervals cost more.
        Right now Prowl uses about {points.toLocaleString('en-US')} points an hour, and it waits for
        the limit to reset if you run low.
      </p>
    </SettingsGroup>
  );
}

function AppearanceSettings() {
  const { theme, sort, badge } = settings.value;
  return (
    <SettingsGroup title="Appearance">
      <Select
        label="Theme"
        value={theme}
        options={THEMES}
        onValueChange={(value) => void saveSettings({ theme: value })}
      />
      <Select
        label="Sort pull requests by"
        value={sort}
        options={SORTS}
        onValueChange={(value) => void saveSettings({ sort: value })}
      />
      <Select
        label="Toolbar badge"
        value={badge}
        options={BADGES}
        hint={BADGE_HINTS[badge]}
        onValueChange={(value) => void saveSettings({ badge: value })}
      />
    </SettingsGroup>
  );
}

/** Everything the user can configure. Every control saves as soon as it changes. */
export function SettingsView() {
  return (
    <div class="settings">
      <h2 class="settings__title">Settings</h2>
      <ScopeSettings />
      <PollingSettings />
      <NotificationsSettings />
      <AppearanceSettings />
      <AccountSettings />
      <PrivacySettings />
      <AboutSettings />
    </div>
  );
}
