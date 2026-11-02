import { useState } from 'preact/hooks';
import { MAX_TEAM_SEARCHES, teamKey } from '../../lib/github/teams';
import { t } from '../../lib/i18n';
import type { Team, TeamsState } from '../../lib/model';
import { formatRelativeTime } from '../../lib/time/relative';
import { SyncIcon } from '../components/icons';
import { Button } from '../components/ui/Button';
import { Switch } from '../components/ui/Switch';
import { useNow } from '../components/useNow';
import { sendToBackground } from '../state/background';
import { navigate } from '../state/router';
import { saveSettings } from '../state/settings';
import { settings, teams } from '../state/store';
import { SettingsGroup } from './SettingsGroup';

/** Teams by organization, organizations in the order the worker sorted them (by key). */
function byOrg(list: readonly Team[]): [string, Team[]][] {
  const orgs = new Map<string, Team[]>();
  for (const team of list) orgs.set(team.org, [...(orgs.get(team.org) ?? []), team]);
  return [...orgs];
}

function followTeam(key: string, on: boolean) {
  void saveSettings(
    (current) => ({
      ...current,
      unfollowedTeams: on
        ? current.unfollowedTeams.filter((k) => k !== key)
        : [...current.unfollowedTeams.filter((k) => k !== key), key],
    }),
    { refresh: true },
  );
}

function TeamNotice({ state }: { state: TeamsState | undefined }) {
  return (
    <>
      {state?.error && (
        <div class="settings-teams__error" role="status">
          <p class="settings-note">{state.error.message}</p>
          {state.error.kind === 'missing_scope' && (
            <Button size="sm" variant="secondary" onClick={() => navigate('onboarding')}>
              {t('signInAgain')}
            </Button>
          )}
        </div>
      )}
      {state && !state.error && state.teams.length === 0 && (
        <p class="settings-note">{t('githubListsNoTeamForYourAccount')}</p>
      )}
    </>
  );
}

function TeamGroups({ list, unfollowed }: { list: readonly Team[]; unfollowed: Set<string> }) {
  return (
    <>
      {byOrg(list).map(([org, list]) => (
        <fieldset class="settings-teams__org" key={org}>
          <legend class="settings-teams__legend">{org}</legend>
          {list.map((team) => {
            const key = teamKey(team);
            return (
              <Switch
                key={key}
                label={team.name}
                description={`@${team.org}/${team.slug}`}
                checked={!unfollowed.has(key)}
                onChange={(on) => followTeam(key, on)}
              />
            );
          })}
        </fieldset>
      ))}
    </>
  );
}

/**
 * The teams the worker discovered for "Team reviews", each followed unless unfollowed here, with
 * a refresh and the way out when the token cannot list them (no read:org).
 */
export function TeamsSettings() {
  useNow(60_000);
  const [refreshing, setRefreshing] = useState(false);
  const state = teams.value;
  const { unfollowedTeams, sections } = settings.value;
  const unfollowed = new Set(unfollowedTeams);
  const sectionOn = sections.some((s) => s.kind === 'team_review_requested' && s.enabled);
  const followed = (state?.teams ?? []).filter((team) => !unfollowed.has(teamKey(team))).length;
  const refresh = async () => {
    setRefreshing(true);
    await sendToBackground({ type: 'refreshTeams' });
    setRefreshing(false);
  };
  return (
    <SettingsGroup title={t('teams')} description={t('teamReviewsListsThePullRequestsThatAskOne')}>
      {!sectionOn && <p class="settings-note">{t('turnOnTeamReviewsUnderSectionsToSeeThem')}</p>}
      <TeamNotice state={state} />
      <TeamGroups list={state?.teams ?? []} unfollowed={unfollowed} />
      {followed > MAX_TEAM_SEARCHES && (
        <p class="settings-note">{t('teamSearchBudget', followed, MAX_TEAM_SEARCHES)}</p>
      )}
      <div class="settings-teams__refresh">
        <Button
          size="sm"
          variant="secondary"
          icon={<SyncIcon size={12} />}
          loading={refreshing}
          onClick={() => void refresh()}
        >
          {t('refreshTeams')}
        </Button>
        <span class="settings-note">
          {state
            ? t('checked', formatRelativeTime(state.fetchedAt, Date.now()))
            : t('notCheckedYet')}
        </span>
      </div>
    </SettingsGroup>
  );
}
