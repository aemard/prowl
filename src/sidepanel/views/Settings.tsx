import { useEffect } from 'preact/hooks';
import type { BadgeMode, SortOrder, Theme } from '../../lib/model';
import {
  MAX_PER_SECTION,
  MAX_POLL_INTERVAL_MINUTES,
  MIN_PER_SECTION,
  MIN_POLL_INTERVAL_MINUTES,
} from '../../lib/storage/settings';
import { NumberField } from '../components/NumberField';
import { Select, type SelectOption } from '../components/ui/Select';
import { Switch } from '../components/ui/Switch';
import { PR_LIMIT_ID, saveSettings, settingsFocus } from '../state/settings';
import { settings, teams } from '../state/store';
import { AccountSettings } from './SettingsAccount';
import { SettingsGroup, settingsGroupId } from './SettingsGroup';
import { BADGE_HINTS, estimatedPointsPerHour, HOURLY_POINTS, teamSearches } from './SettingsModel';
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
      <NumberField
        id={PR_LIMIT_ID}
        label="Maximum pull requests loaded per section"
        value={maxPerSection}
        min={MIN_PER_SECTION}
        max={MAX_PER_SECTION}
        hint="Loaded before snooze. PRs outside every loaded section are not monitored."
        onCommit={(value) => void saveSettings({ maxPerSection: value }, { refresh: true })}
      />
      <details class="settings-details">
        <summary>Refresh options</summary>
        <NumberField
          label="Check every (minutes)"
          value={pollIntervalMinutes}
          min={MIN_POLL_INTERVAL_MINUTES}
          max={MAX_POLL_INTERVAL_MINUTES}
          onCommit={(value) => void saveSettings({ pollIntervalMinutes: value })}
        />
        <p class="settings-note">
          GitHub gives each token {HOURLY_POINTS.toLocaleString('en-US')} points an hour, and every
          check of every section spends some: more pull requests and shorter intervals cost more. A
          baseline estimate is about {points.toLocaleString('en-US')} points an hour; extra pages,
          merge reads and actions can cost more. Prowl waits for the limit to reset if you run low.
        </p>
      </details>
    </SettingsGroup>
  );
}

function AppearanceSettings() {
  const { theme, sort, groupByRepo, badge } = settings.value;
  return (
    <SettingsGroup title="List">
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

/** The groups below, in order, as the section links name them. */
const SECTIONS = [
  ['Sections', 'Sections'],
  ['Refresh', 'Refresh'],
  ['Notifications', 'Notifications'],
  ['List', 'List'],
  ['Account', 'Account'],
  ['Privacy and permissions', 'Privacy and permissions'],
] as const;

/**
 * Links to each group of a long screen. The hash is the route, so a link scrolls to its group and
 * moves focus to the group's title instead of following its href.
 */
function SectionLinks() {
  return (
    <nav class="settings__nav" aria-label="Settings sections">
      <ul class="settings-links">
        {SECTIONS.map(([title, label]) => (
          <li key={title}>
            <a
              href={`#${settingsGroupId(title)}`}
              onClick={(event) => {
                event.preventDefault();
                const heading = document.querySelector<HTMLElement>(
                  `#${settingsGroupId(title)} > h3`,
                );
                heading?.scrollIntoView({ block: 'start' });
                heading?.focus({ preventScroll: true });
              }}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Everything the user can configure. Every control saves as soon as it changes. */
export function SettingsView() {
  useEffect(() => {
    if (settingsFocus.peek() !== 'pr-limit') return;
    settingsFocus.value = undefined;
    const field = document.getElementById(PR_LIMIT_ID);
    field?.scrollIntoView({ block: 'center' });
    field?.focus({ preventScroll: true });
  }, []);

  return (
    <div class="settings">
      <h2 class="settings__title">Settings</h2>
      <SectionLinks />
      <ScopeSettings />
      <PollingSettings />
      <NotificationsSettings />
      <AppearanceSettings />
      <AccountSettings />
      <PrivacySettings />
    </div>
  );
}
