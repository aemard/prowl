import { useEffect } from 'preact/hooks';
import { t } from '../../lib/i18n';
import type { BadgeMode, Language, SortOrder, Theme } from '../../lib/model';
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
import { settings } from '../state/store';
import { AccountSettings } from './SettingsAccount';
import { SettingsGroup, settingsGroupId } from './SettingsGroup';
import { BADGE_HINTS } from './SettingsModel';
import { NotificationsSettings } from './SettingsNotifications';
import { PrivacySettings } from './SettingsPrivacy';
import { ScopeSettings } from './SettingsScope';

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
  const { pollIntervalMinutes, maxPerSection } = settings.value;
  return (
    <SettingsGroup title={t('refresh')}>
      <NumberField
        id={PR_LIMIT_ID}
        label={t('pullRequestsPerSection')}
        value={maxPerSection}
        min={MIN_PER_SECTION}
        max={MAX_PER_SECTION}
        hint={t('prowlOnlyWatchesThePullRequestsItLoads')}
        onCommit={(value) => void saveSettings({ maxPerSection: value }, { refresh: true })}
      />
      <NumberField
        label={t('refreshEveryMinutes')}
        value={pollIntervalMinutes}
        min={MIN_POLL_INTERVAL_MINUTES}
        max={MAX_POLL_INTERVAL_MINUTES}
        onCommit={(value) => void saveSettings({ pollIntervalMinutes: value })}
      />
      <p class="settings-note">{t('morePullRequestsAndShorterIntervalsUseMoreOfGitHub')}</p>
    </SettingsGroup>
  );
}

const LANGUAGES: SelectOption<Language>[] = [
  { value: 'system', label: t('matchChromeLanguage') },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
];

function AppearanceSettings() {
  const { theme, sort, groupByRepo, badge } = settings.value;
  return (
    <SettingsGroup title={t('list')}>
      <Select
        label={t('language')}
        name="language"
        value={settings.value.language}
        options={LANGUAGES}
        hint={t('languageHint')}
        onValueChange={(language) => void saveSettings({ language })}
      />
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
  [t('sections'), t('sections')],
  [t('refresh'), t('refresh')],
  [t('notifications'), t('notifications')],
  [t('list'), t('list')],
  [t('account2'), t('account2')],
  [t('privacyAndPermissions'), t('privacyAndPermissions')],
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
  useEffect(() => {
    if (settingsFocus.peek() !== 'pr-limit') return;
    settingsFocus.value = undefined;
    const field = document.getElementById(PR_LIMIT_ID);
    field?.scrollIntoView({ block: 'center' });
    field?.focus({ preventScroll: true });
  }, []);

  return (
    <div class="settings">
      <h2 class="settings__title">{t('settings')}</h2>
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
