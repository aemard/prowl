import { useEffect, useState } from 'preact/hooks';
import { env } from '../../lib/env';
import { OPEN_PANEL_COMMAND } from '../../lib/model';
import { GitHubLink } from '../components/GitHubLink';
import { LinkExternalIcon, SignOutIcon } from '../components/icons';
import { SignOutDialog } from '../components/SignOutDialog';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { auth } from '../state/store';
import { SettingsGroup } from './SettingsGroup';
import { TOKEN_TYPES } from './SettingsModel';

/** Where Prowl's code and docs live. Opened through `openGitHubUrl`, so on the GitHub origin. */
const REPO_URL = `${env.webUrl}/aemard/prowl`;
/** The permission table of the privacy policy. */
export const PRIVACY_URL = `${REPO_URL}/blob/main/docs/privacy.md`;
const ABOUT_LINKS = [
  { label: 'Documentation', href: `${REPO_URL}/tree/main/docs` },
  { label: 'Privacy', href: PRIVACY_URL },
  { label: 'Source code', href: REPO_URL },
];

/** Who is signed in, with what kind of token, and the way out. */
export function AccountSettings() {
  const [confirming, setConfirming] = useState(false);
  const account = auth.value;
  if (!account) return null;
  const { viewer, tokenType, scopes } = account;

  return (
    <SettingsGroup title="Account">
      <div class="settings-account">
        <Avatar src={viewer.avatarUrl} />
        <p class="settings-account__names">
          <strong>{viewer.login}</strong>
          {viewer.name && <span class="settings-note">{viewer.name}</span>}
        </p>
      </div>
      <dl class="settings-facts">
        <div>
          <dt>Token</dt>
          <dd>{TOKEN_TYPES[tokenType]}</dd>
        </div>
        <div>
          <dt>Scopes</dt>
          <dd>
            {scopes.length > 0 ? (
              <span class="settings-scopes">
                {scopes.map((scope) => (
                  <Badge key={scope} variant="outline">
                    {scope}
                  </Badge>
                ))}
              </span>
            ) : tokenType === 'fine_grained' ? (
              'None: fine-grained tokens use per-repository permissions.'
            ) : (
              'None'
            )}
          </dd>
        </div>
      </dl>
      <Button class="settings-add" icon={<SignOutIcon />} onClick={() => setConfirming(true)}>
        Sign out
      </Button>
      <SignOutDialog open={confirming} onClose={() => setConfirming(false)} />
    </SettingsGroup>
  );
}

/** The shortcut Chrome gives the open-panel command: the suggested one unless the user changed it. */
function useOpenShortcut(): string | undefined {
  const [shortcut, setShortcut] = useState<string>();
  useEffect(() => {
    void chrome.commands
      .getAll()
      .then((all) => setShortcut(all.find((c) => c.name === OPEN_PANEL_COMMAND)?.shortcut ?? ''));
  }, []);
  return shortcut;
}

export function AboutSettings() {
  const shortcut = useOpenShortcut();
  return (
    <SettingsGroup title="About">
      <p>Version {chrome.runtime.getManifest().version}</p>
      {shortcut !== undefined && (
        <p class="settings-note">
          {shortcut ? (
            <>
              Open Prowl from the keyboard with <kbd>{shortcut}</kbd>.
            </>
          ) : (
            'No keyboard shortcut opens Prowl yet.'
          )}{' '}
          Change it at chrome://extensions/shortcuts.
        </p>
      )}
      <ul class="settings-links">
        {ABOUT_LINKS.map(({ label, href }) => (
          <li key={label}>
            <GitHubLink class="settings-link" href={href}>
              {label}
              <LinkExternalIcon size={12} />
            </GitHubLink>
          </li>
        ))}
      </ul>
    </SettingsGroup>
  );
}
