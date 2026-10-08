import type { BadgeMode, SortOrder, Theme } from '../../lib/model';
import {
  MAX_HIDE_STALE_DAYS,
  MAX_PER_SECTION,
  MAX_POLL_INTERVAL_MINUTES,
  MIN_HIDE_STALE_DAYS,
  MIN_PER_SECTION,
  MIN_POLL_INTERVAL_MINUTES,
} from '../../lib/storage/settings';
import { NumberField } from '../components/NumberField';
import { Select, type SelectOption } from '../components/ui/Select';
import { Switch } from '../components/ui/Switch';
import { saveSettings } from '../state/settings';
import { settings, teams } from '../state/store';
import { AboutSettings, AccountSettings } from './SettingsAccount';
import { SettingsGroup } from './SettingsGroup';
import { BADGE_HINTS, estimatedPointsPerHour, HOURLY_POINTS, teamSearches } from './SettingsModel';
import { NotificationsSettings } from './SettingsNotifications';
import { PrivacySettings } from './SettingsPrivacy';
import { ScopeSettings } from './SettingsScope';
import { TeamsSettings } from './SettingsTeams';

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
  const { pollIntervalMinutes, maxPerSection, sections, unfollowedTeams } = settings.value;
  const searches = sections
    .filter((section) => section.enabled)
    .reduce(
      (total, section) =>
        total +
        (section.kind === 'team_review_requested'
          ? teamSearches(teams.value?.teams ?? [], unfollowedTeams)
          : 1),
      0,
    );
  const points = estimatedPointsPerHour(searches, maxPerSection, pollIntervalMinutes);
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
  const { theme, sort, groupByRepo, badge, hideStaleAfterDays, hideDrafts, hideBots } =
    settings.value;
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
      <Switch
        label="Group pull requests by repository"
        description="Lists each repository’s pull requests under a header you can fold, in the order chosen above."
        checked={groupByRepo}
        onChange={(checked) => void saveSettings({ groupByRepo: checked })}
      />
      <NumberField
        label="Hide PRs with no commit for (days)"
        value={hideStaleAfterDays}
        min={MIN_HIDE_STALE_DAYS}
        max={MAX_HIDE_STALE_DAYS}
        hint="They stay out of the list, the counts and the badge until you choose “Show hidden”, and still notify you. 0 never hides."
        onCommit={(value) => void saveSettings({ hideStaleAfterDays: value })}
      />
      <Switch
        label="Hide draft PRs"
        description="Shown again with “Show hidden”. They still notify you."
        checked={hideDrafts}
        onChange={(checked) => void saveSettings({ hideDrafts: checked })}
      />
      <Switch
        label="Hide PRs opened by bots"
        description="Dependabot, Renovate and other apps. Shown again with “Show hidden”. They still notify you."
        checked={hideBots}
        onChange={(checked) => void saveSettings({ hideBots: checked })}
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
      <TeamsSettings />
      <PollingSettings />
      <NotificationsSettings />
      <AppearanceSettings />
      <AccountSettings />
      <PrivacySettings />
      <AboutSettings />
    </div>
  );
}
