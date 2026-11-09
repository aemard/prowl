import type { ComponentChildren } from 'preact';
import { useId, useRef, useState } from 'preact/hooks';
import { env } from '../../lib/env';
import { AUTH_DOCS_URL } from '../../lib/github/auth/deviceFlow';
import { signInErrorMessage, TOKEN_URLS, validatePat } from '../../lib/github/auth/pat';
import { t } from '../../lib/i18n';
import { LinkExternalIcon } from '../components/icons';
import { Message } from '../components/Message';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { TextField } from '../components/ui/TextField';
import { openGitHubUrl } from '../openUrl';
import { completeSignIn } from '../state/session';
import { DeviceFlow } from './DeviceFlow';
import './Onboarding.css';

/** A link to a GitHub page; opens through the allowlisted helper, not in the panel itself. */
function GitHubLink({ href, children }: { href: string; children: ComponentChildren }) {
  return (
    <a
      class="onboarding__link"
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault();
        void openGitHubUrl(href);
      }}
    >
      {children}
      <LinkExternalIcon size={12} />
    </a>
  );
}

/** Keep token validation and error focus together across disclosure changes. */
function useTokenForm() {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLElement>(null);

  async function submit(event: Event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const { auth, warning } = await validatePat(token);
      await completeSignIn(auth, warning);
    } catch (failure) {
      setError(signInErrorMessage(failure));
      setBusy(false);
      // Screen readers read the error with the field it belongs to.
      input.current?.focus();
    }
  }

  return { token, setToken, error, busy, input, submit };
}

/** Shown while signed out: sign in from the browser, or paste a token and learn how to make one. */
export function OnboardingView() {
  const deviceFlow = env.clientId !== '';
  const [patOpen, setPatOpen] = useState(!deviceFlow);
  const patId = useId();
  const { token, setToken, error, busy, input, submit } = useTokenForm();

  return (
    <div class="onboarding">
      <EmptyState
        class="onboarding__intro"
        title={t('seeYourPullRequestsHere')}
        description={t('approveProwlOnGitHubYourTokenStaysInThisBrowser')}
      />

      {deviceFlow ? (
        <>
          <DeviceFlow onTokenFallback={() => setPatOpen(true)} />
          <Button
            variant="ghost"
            aria-expanded={patOpen}
            aria-controls={patId}
            onClick={() => setPatOpen(!patOpen)}
          >
            {t('useAPersonalAccessToken')}
          </Button>
        </>
      ) : (
        <p class="onboarding__unavailable">
          {t('signingInFromTheBrowserIsNotAvailableIn')}{' '}
          <GitHubLink href={AUTH_DOCS_URL}>{t('howToSignInWithAToken')}</GitHubLink>
        </p>
      )}

      <div id={patId} hidden={!patOpen}>
        <form class="onboarding__form" onSubmit={submit} noValidate>
          <TextField
            label={t('personalAccessToken')}
            type="password"
            value={token}
            onValueChange={setToken}
            error={error}
            placeholder={t('tokenPlaceholder')}
            autoComplete="off"
            spellcheck={false}
            inputRef={input}
          />
          <Button type="submit" variant={deviceFlow ? 'secondary' : 'primary'} loading={busy}>
            {t('signIn')}
          </Button>
        </form>

        <section class="onboarding__tokens" aria-label={t('createAToken')}>
          <article class="onboarding__card">
            <header class="onboarding__card-header">
              <h3 class="onboarding__card-title">{t('classicToken')}</h3>
              <Badge tone="success">{t('recommended')}</Badge>
            </header>
            <p>
              <Message id="classicTokenHelp" values={[<code>repo</code>, <code>read:org</code>]} />
            </p>
            <GitHubLink href={TOKEN_URLS.classic}>{t('createAClassicToken')}</GitHubLink>
          </article>

          <article class="onboarding__card">
            <header class="onboarding__card-header">
              <h3 class="onboarding__card-title">{t('fineGrainedToken')}</h3>
              <Badge tone="attention">{t('limited')}</Badge>
            </header>
            <p>{t('coversOneAccountOrOrganizationAndTheRepositoriesYou')}</p>
            <GitHubLink href={TOKEN_URLS.fineGrained}>{t('createAFineGrainedToken')}</GitHubLink>
          </article>
        </section>
      </div>
    </div>
  );
}
