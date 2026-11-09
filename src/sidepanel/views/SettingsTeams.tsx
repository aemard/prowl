import { useEffect, useState } from 'preact/hooks';
import { teamKey } from '../../lib/github/teams';
import { t } from '../../lib/i18n';
import type { Team, TeamsState } from '../../lib/model';
import { SyncIcon } from '../components/icons';
import { Button } from '../components/ui/Button';
import { Switch } from '../components/ui/Switch';
import { sendToBackground } from '../state/background';
import { navigate } from '../state/router';
import { saveSettings } from '../state/settings';
import { auth, pollState, settings, snapshot, teams } from '../state/store';
import './Settings.css';
import './SettingsTeams.css';

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
  const fineGrained = auth.value?.tokenType === 'fine_grained';
  const snap = snapshot.value;
  const unidentified = settings.value.sections
    .filter((section) => section.enabled && section.kind === 'team_review_requested')
    .some((section) => snap?.sections[section.id]?.some((id) => !snap.teamRequests?.[id]?.length));
  return (
    <>
      {state?.error && (
        <div class="settings-teams__error" role="status">
          <p class="settings-note">
            {state.error.kind === 'missing_scope'
              ? fineGrained
                ? t('useAFineGrainedTokenOwnedByTheOrganizationWith')
                : t('prowlCanTSeeYourTeams')
              : t('couldnTLoadYourTeams')}
          </p>
          {state.error.kind === 'missing_scope' && !fineGrained && (
            <Button size="sm" variant="secondary" onClick={() => navigate('onboarding')}>
              {t('signInAgain')}
            </Button>
          )}
        </div>
      )}
      {settings.value.unfollowedTeams.length > 0 && (!state || state.error || unidentified) && (
        <p class="settings-note">{t('thisTokenCanTTellWhichTeamAskedSoSwitched')}</p>
      )}
      {state && !state.error && state.teams.length === 0 && (
        <p class="settings-note">{t('githubListsNoTeamForYourAccount')}</p>
      )}
    </>
  );
}

function TeamGroups({
  list,
  unfollowed,
  onFollowTeam,
}: {
  list: readonly Team[];
  unfollowed: Set<string>;
  onFollowTeam: (key: string, on: boolean) => void;
}) {
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
                label={`@${team.org}/${team.slug}`}
                checked={!unfollowed.has(key)}
                onChange={(on) => onFollowTeam(key, on)}
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
export function TeamPicker() {
  const [refreshing, setRefreshing] = useState(false);
  const state =
    !auth.value || teams.value?.login === auth.value.viewer.login ? teams.value : undefined;
  const unfollowed = new Set(settings.value.unfollowedTeams);
  useTeamDiscovery();
  const refresh = async () => {
    setRefreshing(true);
    await sendToBackground({ type: 'refreshTeams' });
    setRefreshing(false);
  };
  return (
    <div class="team-picker">
      <TeamNotice state={state} />
      {!state && (
        <p class="settings-note" role="status">
          {t('loadingYourTeams')}
        </p>
      )}
      <TeamGroups list={state?.teams ?? []} unfollowed={unfollowed} onFollowTeam={followTeam} />
      <div class="settings-teams__refresh">
        <span class="settings-note">{t('missingATeam')}</span>
        <Button
          size="sm"
          variant="secondary"
          icon={<SyncIcon size={12} />}
          loading={refreshing}
          onClick={() => void refresh()}
        >
          {state?.error && state.error.kind !== 'missing_scope' ? t('tryAgain') : t('refresh')}
        </Button>
      </div>
    </div>
  );
}

/** Discovery is shared by the collapsed section and either inline picker. */
let discovering = false;
function useTeamDiscovery() {
  const account = auth.value;
  const state = teams.value;
  const polling = pollState.value?.inFlight;
  useEffect(() => {
    if (!account || state?.login === account.viewer.login || discovering || polling) return;
    discovering = true;
    void sendToBackground({ type: 'refreshTeams' }).finally(() => {
      discovering = false;
    });
  }, [account, state, polling]);
}
