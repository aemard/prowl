import { useState } from 'preact/hooks';
import { MAX_TEAM_SEARCHES, teamKey } from '../../lib/github/teams';
import type { Team, TeamsState } from '../../lib/model';
import { formatRelativeTime } from '../../lib/time/relative';
import { SyncIcon } from '../components/icons';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Switch } from '../components/ui/Switch';
import { useNow } from '../components/useNow';
import { sendToBackground } from '../state/background';
import { navigate } from '../state/router';
import { saveSettings } from '../state/settings';
import { auth, settings, teams } from '../state/store';
import './Settings.css';

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

type TeamSelection = {
  unfollowedTeams?: string[];
  onFollowTeam?: (key: string, on: boolean) => void;
};

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
                label={team.name}
                description={`@${team.org}/${team.slug}`}
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
export function TeamPicker({
  unfollowedTeams = settings.value.unfollowedTeams,
  onFollowTeam = followTeam,
}: TeamSelection = {}) {
  useNow(60_000);
  const [refreshing, setRefreshing] = useState(false);
  const state =
    !auth.value || teams.value?.login === auth.value.viewer.login ? teams.value : undefined;
  const unfollowed = new Set(unfollowedTeams);
  const followed = (state?.teams ?? []).filter((team) => !unfollowed.has(teamKey(team))).length;
  const refresh = async () => {
    setRefreshing(true);
    await sendToBackground({ type: 'refreshTeams' });
    setRefreshing(false);
  };
  return (
    <div class="team-picker">
      <TeamNotice state={state} />
      {!state && <p class="settings-note">Teams are not loaded yet. Refresh to try again.</p>}
      <TeamGroups list={state?.teams ?? []} unfollowed={unfollowed} onFollowTeam={onFollowTeam} />
      {followed > MAX_TEAM_SEARCHES && (
        <p class="settings-note">
          You follow {followed} teams; Prowl searches the first {MAX_TEAM_SEARCHES} to stay within
          GitHub’s rate limit. Unfollow the ones you do not need.
        </p>
      )}
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

/** Shared entry point: Dialog supplies focus trapping and restoration. */
export function ChooseTeams() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Choose teams
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Team reviews"
        description="These teams' review requests appear in this section. Prowl checks at most 10 teams each refresh."
        footer={<Button onClick={() => setOpen(false)}>Done</Button>}
      >
        <TeamPicker />
      </Dialog>
    </>
  );
}

export function TeamReviewsHeader() {
  const state =
    !auth.value || teams.value?.login === auth.value.viewer.login ? teams.value : undefined;
  const followed = (state?.teams ?? []).filter(
    (team) => !settings.value.unfollowedTeams.includes(teamKey(team)),
  ).length;
  return (
    <div>
      <div class="settings-note">
        {followed > MAX_TEAM_SEARCHES
          ? `Checking 10 of ${followed} teams`
          : `Following ${followed} teams`}{' '}
        · <ChooseTeams />
      </div>
      <TeamNotice state={state} />
    </div>
  );
}
