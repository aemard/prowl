import { useEffect, useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { STORAGE_KEYS } from '../../lib/model';
import { setItem } from '../../lib/storage/storage';
import { GitHubLink } from '../components/GitHubLink';
import { LinkExternalIcon } from '../components/icons';
import { Switch } from '../components/ui/Switch';
import { sync } from '../state/store';
import { PRIVACY_URL } from './SettingsAccount';
import { SettingsGroup } from './SettingsGroup';
import { describePermissions } from './SettingsModel';

/** The promise the manifest lock (tests/unit/siteAccess.test.ts) keeps. */
const NO_SITE_ACCESS = t('prowlCannotSeeOrChangeThePagesYouVisit');

/** What Chrome says Prowl may do right now, kept current as permissions are granted or removed. */
function useGrantedPermissions() {
  const [granted, setGranted] = useState<chrome.permissions.Permissions>();
  useEffect(() => {
    let live = true;
    const read = () =>
      void chrome.permissions.getAll().then((all) => {
        if (live) setGranted(all);
      });
    read();
    chrome.permissions.onAdded.addListener(read);
    chrome.permissions.onRemoved.addListener(read);
    return () => {
      live = false;
      chrome.permissions.onAdded.removeListener(read);
      chrome.permissions.onRemoved.removeListener(read);
    };
  }, []);
  return granted;
}

/** The promise, and the permissions that back it, read from Chrome rather than from the docs. */
export function PrivacySettings() {
  const granted = useGrantedPermissions();
  return (
    <SettingsGroup title={t('privacyAndPermissions')}>
      <p class="settings-promise">{NO_SITE_ACCESS}</p>
      <Switch
        label={t('syncSettingsWithYourChromeProfile')}
        description={t('yourSettingsFollowYouToChromeOnYourOther')}
        checked={sync.value?.enabled === true}
        onChange={(on) => void setItem(STORAGE_KEYS.sync, { enabled: on, error: null })}
      />
      {sync.value?.enabled && sync.value.error && (
        <p class="settings-note" role="status">
          {sync.value.error}
        </p>
      )}
      {granted && (
        <ul class="settings-permissions" aria-label={t('whatProwlMayDo')}>
          {describePermissions(granted).map(({ title, detail }) => (
            <li key={title}>
              <span class="settings-permissions__name">{title}</span>
              <span class="settings-note">{detail}</span>
            </li>
          ))}
        </ul>
      )}
      <GitHubLink class="settings-link" href={PRIVACY_URL}>
        {t('readThePrivacyPolicy')}
        <LinkExternalIcon size={12} />
      </GitHubLink>
    </SettingsGroup>
  );
}
