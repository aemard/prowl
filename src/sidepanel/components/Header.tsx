import { useState } from 'preact/hooks';
import { env } from '../../lib/env';
import { t, uiLocale } from '../../lib/i18n';
import { formatRelativeTime } from '../../lib/time/relative';
import { openGitHubUrl } from '../openUrl';
import { navigate, route } from '../state/router';
import { requestRefresh } from '../state/shortcuts';
import { auth, listRefreshing, snapshot } from '../state/store';
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
      <p class="header__updated">{listRefreshing.value ? t('updating') : t('notUpdatedYet')}</p>
    );
  }
  return (
    <p class="header__updated">
      <time dateTime={fetchedAt} title={new Date(fetchedAt).toLocaleString(uiLocale())}>
        {t('updatedAgo', formatRelativeTime(fetchedAt))}
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
          <IconButton label={t('refresh')} loading={listRefreshing.value} onClick={requestRefresh}>
            <SyncIcon />
          </IconButton>
          <IconButton
            label={inSettings ? t('backToPullRequests') : t('settings')}
            onClick={() => navigate(inSettings ? 'list' : 'settings')}
          >
            {inSettings ? <ArrowLeftIcon /> : <GearIcon />}
          </IconButton>
          <Menu
            align="end"
            items={[
              {
                id: 'profile',
                label: t('viewGithubProfile'),
                icon: <LinkExternalIcon />,
                onSelect: () =>
                  void openGitHubUrl(`${env.webUrl}/${encodeURIComponent(viewer.login)}`),
              },
              {
                id: 'shortcuts',
                label: t('keyboardShortcuts'),
                hint: '?',
                icon: <InfoIcon />,
                onSelect: () => {
                  shortcutsOpen.value = true;
                },
              },
              'separator',
              {
                id: 'sign-out',
                label: t('signOut'),
                icon: <SignOutIcon />,
                danger: true,
                onSelect: () => setConfirmingSignOut(true),
              },
            ]}
            trigger={(props) => (
              <IconButton {...props} label={t('account', viewer.login)}>
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
