import { t } from '../../lib/i18n';
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
import { SettingsGroup, settingsGroupId } from './SettingsGroup';
import { BADGE_HINTS, estimatedPointsPerHour, HOURLY_POINTS, teamSearches } from './SettingsModel';
import { NotificationsSettings } from './SettingsNotifications';
import { PrivacySettings } from './SettingsPrivacy';
import { ScopeSettings } from './SettingsScope';
import { TeamsSettings } from './SettingsTeams';

const THEMES: SelectOption<Theme>[] = [
  { value: 'system', label: t('matchSystem') },
  { value: 'light', label: t('light') },
  { value: 'dark', label: t('dark') },
];

const SORTS: SelectOption<SortOrder>[] = [
  { value: 'updated', label: t('recentlyUpdated') },
  { value: 'created', label: t('newestFirst') },
  { value: 'repo', label: t('repository2') },
];

const BADGES: SelectOption<BadgeMode>[] = [
  { value: 'attention', label: t('needsAttention') },
  { value: 'unseen', label: t('unseenChanges') },
  { value: 'off', label: t('off') },
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
    <SettingsGroup title={t('refresh')}>
      <div class="settings-pair">
        <NumberField
          label={t('checkEveryMinutes')}
          value={pollIntervalMinutes}
          min={MIN_POLL_INTERVAL_MINUTES}
          max={MAX_POLL_INTERVAL_MINUTES}
          onCommit={(value) => void saveSettings({ pollIntervalMinutes: value })}
        />
        <NumberField
          label={t('pullRequestsPerSection')}
          value={maxPerSection}
          min={MIN_PER_SECTION}
          max={MAX_PER_SECTION}
          onCommit={(value) => void saveSettings({ maxPerSection: value }, { refresh: true })}
        />
      </div>
      <p class="settings-note">{t('pollingBudget', HOURLY_POINTS, points)}</p>
    </SettingsGroup>
  );
}

function AppearanceSettings() {
  const { theme, sort, groupByRepo, badge, hideStaleAfterDays, hideDrafts, hideBots } =
    settings.value;
  return (
    <SettingsGroup title={t('appearance')}>
      <Select
        label={t('theme')}
        value={theme}
        options={THEMES}
        onValueChange={(value) => void saveSettings({ theme: value })}
      />
      <Select
        label={t('sortPullRequestsBy')}
        value={sort}
        options={SORTS}
        onValueChange={(value) => void saveSettings({ sort: value })}
      />
      <Switch
        label={t('groupPullRequestsByRepository')}
        description={t('listsEachRepositorySPullRequestsUnderAHeader')}
        checked={groupByRepo}
        onChange={(checked) => void saveSettings({ groupByRepo: checked })}
      />
      <NumberField
        label={t('hidePrsWithNoCommitForDays')}
        value={hideStaleAfterDays}
        min={MIN_HIDE_STALE_DAYS}
        max={MAX_HIDE_STALE_DAYS}
        hint={t('theyStayOutOfTheListTheCountsAnd')}
        onCommit={(value) => void saveSettings({ hideStaleAfterDays: value })}
      />
      <Switch
        label={t('hideDraftPrs')}
        description={t('shownAgainWithShowHiddenTheyStillNotifyYou')}
        checked={hideDrafts}
        onChange={(checked) => void saveSettings({ hideDrafts: checked })}
      />
      <Switch
        label={t('hidePrsOpenedByBots')}
        description={t('dependabotRenovateAndOtherAppsShownAgainWithShow')}
        checked={hideBots}
        onChange={(checked) => void saveSettings({ hideBots: checked })}
      />
      <Select
        label={t('toolbarBadge')}
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
  [t('pullRequests'), t('pullRequests')],
  [t('teams'), t('teams')],
  [t('refresh'), t('refresh')],
  [t('notifications'), t('notifications')],
  [t('appearance'), t('appearance')],
  [t('account2'), t('account2')],
  [t('privacyAndPermissions'), t('privacy')],
  [t('about'), t('about')],
] as const;

/**
 * Links to each group of a long screen. The hash is the route, so a link scrolls to its group and
 * moves focus to the group's title instead of following its href.
 */
function SectionLinks() {
  return (
    <nav class="settings__nav" aria-label={t('settingsSections')}>
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
  return (
    <div class="settings">
      <h2 class="settings__title">{t('settings')}</h2>
      <SectionLinks />
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
