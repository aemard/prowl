import { useState } from 'preact/hooks';
import { MAX_TEAM_SEARCHES, teamKey } from '../../lib/github/teams';
import type { Team } from '../../lib/model';
import { SyncIcon } from '../components/icons';
import { Button } from '../components/ui/Button';
import { Switch } from '../components/ui/Switch';
import { showToast } from '../components/ui/Toast';
import { sendToBackground } from '../state/background';
import { auth, pollState, teams } from '../state/store';
import type { useSetupWizard } from './useSetupWizard';

type Props = Pick<ReturnType<typeof useSetupWizard>, 'unfollowed' | 'followTeam'>;
/** Keep the same organization grouping and team keys as Settings → Teams. */
function teamsByOrg(list: readonly Team[]): [string, Team[]][] {
  const groups = new Map<string, Team[]>();
  for (const team of list) groups.set(team.org, [...(groups.get(team.org) ?? []), team]);
  return [...groups];
}

function SetupTeamGroups({
  availableTeams,
  unfollowed,
  followTeam,
}: Props & { availableTeams: Team[] }) {
  return (
    <>
      {teamsByOrg(availableTeams).map(([org, group]) => (
        <fieldset class="setup__team-org" key={org}>
          <legend class="setup__team-org-title">{org}</legend>
          {group.map((team) => (
            <Switch
              key={teamKey(team)}
              label={team.name}
              description={`@${team.org}/${team.slug}`}
              checked={!unfollowed.includes(teamKey(team))}
              onChange={(enabled) => followTeam(teamKey(team), enabled)}
            />
          ))}
        </fieldset>
      ))}
    </>
  );
}

function SetupTeamNotice({
  discovered,
  refreshingTeams,
}: {
  discovered: typeof teams.value;
  refreshingTeams: boolean;
}) {
  const availableTeams = discovered?.teams ?? [];
  return (
    <>
      {!discovered && (
        <p class="setup__hint" role="status">
          {pollState.value?.inFlight || refreshingTeams
            ? 'Discovering your GitHub teams…'
            : 'Teams are not loaded yet. Refresh to try again.'}
        </p>
      )}
      {discovered?.error && (
        <p class="setup__hint" role="status">
          {discovered.error.message} You can still continue and configure teams later in Settings.
        </p>
      )}
      {discovered && !discovered.error && availableTeams.length === 0 && (
        <p class="setup__hint" role="status">
          GitHub lists no teams for this account.
        </p>
      )}
    </>
  );
}

export function SetupTeams({ unfollowed, followTeam }: Props) {
  const [refreshingTeams, setRefreshingTeams] = useState(false);
  const discovered =
    teams.value?.login.toLowerCase() === auth.value?.viewer.login.toLowerCase()
      ? teams.value
      : undefined;
  const availableTeams = discovered?.teams ?? [];
  const following = availableTeams.filter((team) => !unfollowed.includes(teamKey(team))).length;

  async function refreshTeams() {
    if (refreshingTeams) return;
    setRefreshingTeams(true);
    try {
      await sendToBackground({ type: 'refreshTeams' });
    } catch {
      showToast({ message: 'Could not refresh teams. Try again.', tone: 'danger' });
    } finally {
      setRefreshingTeams(false);
    }
  }

  return (
    <section class="setup__teams" aria-label="Teams to follow">
      <h3 class="setup__teams-title">Choose your teams</h3>
      <p class="setup__hint">
        All teams are followed by default. Uncheck any you don't want to track.
      </p>
      <SetupTeamNotice discovered={discovered} refreshingTeams={refreshingTeams} />
      <SetupTeamGroups
        availableTeams={availableTeams}
        unfollowed={unfollowed}
        followTeam={followTeam}
      />
      {following > MAX_TEAM_SEARCHES && (
        <p class="setup__hint">
          Prowl searches the first {MAX_TEAM_SEARCHES} followed teams to stay within GitHub's rate
          limit. Uncheck any you don't need.
        </p>
      )}
      <Button
        size="sm"
        icon={<SyncIcon size={12} />}
        loading={refreshingTeams}
        onClick={() => void refreshTeams()}
      >
        Refresh teams
      </Button>
    </section>
  );
}
