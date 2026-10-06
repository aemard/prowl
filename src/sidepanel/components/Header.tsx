import { useState } from 'preact/hooks';
import { env } from '../../lib/env';
import { formatRelativeTime } from '../../lib/time/relative';
import { openGitHubUrl } from '../openUrl';
import { sendToBackground } from '../state/background';
import { navigate, route } from '../state/router';
import { signOut } from '../state/session';
import { auth, pollState, snapshot } from '../state/store';
import { ArrowLeftIcon, GearIcon, LinkExternalIcon, SignOutIcon, SyncIcon } from './icons';
import { ProwlMark } from './icons/ProwlMark';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { IconButton } from './ui/IconButton';
import { Menu } from './ui/Menu';
import { showToast } from './ui/Toast';
import { useNow } from './useNow';
import './Header.css';

function UpdatedAt() {
  useNow(15_000);
  const fetchedAt = snapshot.value?.fetchedAt;
  if (!fetchedAt) {
    return (
      <p class="header__updated">{pollState.value?.inFlight ? 'Updating…' : 'Not updated yet'}</p>
    );
  }
  return (
    <p class="header__updated">
      <time dateTime={fetchedAt} title={new Date(fetchedAt).toLocaleString()}>
        Updated {formatRelativeTime(fetchedAt)}
      </time>
    </p>
  );
}

/** Brand, "Updated 2 min ago", refresh, settings and account menu (all but the brand need sign-in). */
export function Header() {
  const viewer = auth.value?.viewer;
  const inSettings = route.value === 'settings';
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  async function confirmSignOut() {
    try {
      await signOut();
    } catch {
      showToast({ message: 'Could not sign out. Try again.', tone: 'danger' });
    }
    setConfirmingSignOut(false);
  }

  return (
    <header class="header">
      <ProwlMark size={24} />
      <div class="header__text">
        <h1 class="header__title">Prowl</h1>
        {viewer && <UpdatedAt />}
      </div>
      {viewer && (
        <div class="header__actions">
          <IconButton
            label="Refresh"
            loading={pollState.value?.inFlight}
            onClick={() => void sendToBackground({ type: 'poll', force: true })}
          >
            <SyncIcon />
          </IconButton>
          <IconButton
            label={inSettings ? 'Back to pull requests' : 'Settings'}
            onClick={() => navigate(inSettings ? 'list' : 'settings')}
          >
            {inSettings ? <ArrowLeftIcon /> : <GearIcon />}
          </IconButton>
          <Menu
            align="end"
            items={[
              {
                id: 'profile',
                label: 'View GitHub profile',
                icon: <LinkExternalIcon />,
                onSelect: () =>
                  void openGitHubUrl(`${env.webUrl}/${encodeURIComponent(viewer.login)}`),
              },
              'separator',
              {
                id: 'sign-out',
                label: 'Sign out',
                icon: <SignOutIcon />,
                danger: true,
                onSelect: () => setConfirmingSignOut(true),
              },
            ]}
            trigger={(props) => (
              <IconButton {...props} label={`Account: ${viewer.login}`}>
                <img class="header__avatar" src={viewer.avatarUrl} alt="" width="24" height="24" />
              </IconButton>
            )}
          />
        </div>
      )}
      <Dialog
        open={confirmingSignOut}
        onClose={() => setConfirmingSignOut(false)}
        title="Sign out?"
        description="Prowl forgets your token and the pull requests it saved in this browser. The token itself stays valid on GitHub until you revoke it there."
        footer={
          <>
            <Button onClick={() => setConfirmingSignOut(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void confirmSignOut()}>
              Sign out
            </Button>
          </>
        }
      />
    </header>
  );
}
