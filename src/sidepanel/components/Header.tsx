import { useState } from 'preact/hooks';
import { env } from '../../lib/env';
import { formatRelativeTime } from '../../lib/time/relative';
import { openGitHubUrl } from '../openUrl';
import { navigate, route } from '../state/router';
import { requestRefresh } from '../state/shortcuts';
import { auth, pollState, snapshot } from '../state/store';
import {
  ArrowLeftIcon,
  GearIcon,
  InfoIcon,
  LinkExternalIcon,
  SignOutIcon,
  SyncIcon,
} from './icons';
import { ProwlMark } from './icons/ProwlMark';
import { shortcutsOpen } from './Shortcuts';
import { SignOutDialog } from './SignOutDialog';
import { IconButton } from './ui/IconButton';
import { Menu } from './ui/Menu';
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

  return (
    <header class="header">
      <ProwlMark size={20} />
      <div class="header__text">
        <h1 class="header__title">Prowl</h1>
        {viewer && <UpdatedAt />}
      </div>
      {viewer && (
        <div class="header__actions">
          <IconButton label="Refresh" loading={pollState.value?.inFlight} onClick={requestRefresh}>
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
              {
                id: 'shortcuts',
                label: 'Keyboard shortcuts',
                hint: '?',
                icon: <InfoIcon />,
                onSelect: () => {
                  shortcutsOpen.value = true;
                },
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
                <img class="header__avatar" src={viewer.avatarUrl} alt="" width="20" height="20" />
              </IconButton>
            )}
          />
        </div>
      )}
      <SignOutDialog open={confirmingSignOut} onClose={() => setConfirmingSignOut(false)} />
    </header>
  );
}
