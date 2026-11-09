import { useEffect, useId, useState } from 'preact/hooks';
import { MAX_TEAM_SEARCHES, teamKey } from '../../lib/github/teams';
import type { Team, TeamsState } from '../../lib/model';
import { formatRelativeTime } from '../../lib/time/relative';
import { SyncIcon } from '../components/icons';
import { Button } from '../components/ui/Button';
import { Switch } from '../components/ui/Switch';
import { useNow } from '../components/useNow';
import { sendToBackground } from '../state/background';
import { navigate } from '../state/router';
import { saveSettings } from '../state/settings';
import { auth, pollState, settings, teams } from '../state/store';
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
  return (
    <>
      {state?.error && (
        <div class="settings-teams__error" role="status">
          <p class="settings-note">{state.error.message}</p>
          {state.error.kind === 'missing_scope' && (
            <Button size="sm" variant="secondary" onClick={() => navigate('onboarding')}>
              Sign in again
            </Button>
          )}
        </div>
      )}
      {state && !state.error && state.teams.length === 0 && (
        <p class="settings-note">GitHub lists no team for your account.</p>
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
  const checked = list
    .filter((team) => !unfollowed.has(teamKey(team)))
    .slice(0, MAX_TEAM_SEARCHES)
    .map(teamKey);
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
                description={`@${team.org}/${team.slug}${!unfollowed.has(key) && !checked.includes(key) ? ' · Not checked. Unfollow another team to include this one.' : ''}`}
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
export function TeamPicker({ showNotice = true }: { showNotice?: boolean } = {}) {
  useNow(60_000);
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
      {showNotice && <TeamNotice state={state} />}
      {!state && showNotice && <p class="settings-note">Loading your teams…</p>}
      <TeamGroups list={state?.teams ?? []} unfollowed={unfollowed} onFollowTeam={followTeam} />
      <p class="settings-note">Prowl checks at most 10 teams each refresh, the first 10 by name.</p>
      <div class="settings-teams__refresh">
        <Button
          size="sm"
          variant="secondary"
          icon={<SyncIcon size={12} />}
          loading={refreshing}
          onClick={() => void refresh()}
        >
          Refresh teams
        </Button>
        <span class="settings-note">
          {state ? `Checked ${formatRelativeTime(state.fetchedAt, Date.now())}` : 'Not checked yet'}
        </span>
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

export function EditTeams({
  initiallyOpen = false,
  section = false,
}: {
  initiallyOpen?: boolean;
  section?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const id = useId();
  useTeamDiscovery();
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        Edit teams
      </Button>
      <div
        id={id}
        class="team-picker-disclosure"
        data-open={open}
        aria-hidden={!open}
        inert={!open}
      >
        <TeamPicker showNotice={!section} />
      </div>
    </>
  );
}

export function TeamReviewsHeader() {
  useTeamDiscovery();
  const state = teams.value?.login === auth.value?.viewer.login ? teams.value : undefined;
  const followed = (state?.teams ?? []).filter(
    (team) => !settings.value.unfollowedTeams.includes(teamKey(team)),
  ).length;
  return (
    <div>
      <div class="settings-note">
        {followed > MAX_TEAM_SEARCHES
          ? `Checking the first 10 of ${followed} teams, by name`
          : `Following ${followed} ${followed === 1 ? 'team' : 'teams'}`}
      </div>
      {!state && <p class="settings-note">Loading your teams…</p>}
      <TeamNotice state={state} />
      <EditTeams section />
    </div>
  );
}
