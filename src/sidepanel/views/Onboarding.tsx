import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { env } from '../../lib/env';
import { AUTH_DOCS_URL } from '../../lib/github/auth/deviceFlow';
import { signInErrorMessage, TOKEN_URLS, validatePat } from '../../lib/github/auth/pat';
import { LinkExternalIcon, MarkGithubIcon } from '../components/icons';
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

/** Shown while signed out: sign in from the browser, or paste a token and learn how to make one. */
export function OnboardingView() {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLElement>(null);
  const deviceFlow = env.clientId !== '';

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

  return (
    <div class="onboarding">
      <EmptyState
        class="onboarding__intro"
        icon={<MarkGithubIcon size={24} />}
        title="Sign in with GitHub"
        description={`${deviceFlow ? 'Approve Prowl on GitHub, or paste' : 'Paste'} a personal access token. It stays in this browser and is only ever sent to GitHub.`}
      />

      {deviceFlow ? (
        <>
          <DeviceFlow />
          <p class="onboarding__or">or paste a token</p>
        </>
      ) : (
        <p class="onboarding__unavailable">
          Signing in from the browser is not available in this build.{' '}
          <GitHubLink href={AUTH_DOCS_URL}>How to sign in with a token</GitHubLink>
        </p>
      )}

      <form class="onboarding__form" onSubmit={submit} noValidate>
        <TextField
          label="Personal access token"
          type="password"
          value={token}
          onValueChange={setToken}
          error={error}
          placeholder="ghp_… or github_pat_…"
          autoComplete="off"
          spellcheck={false}
          inputRef={input}
        />
        <Button type="submit" variant={deviceFlow ? 'secondary' : 'primary'} loading={busy}>
          Sign in
        </Button>
      </form>

      <section class="onboarding__tokens" aria-label="Create a token">
        <article class="onboarding__card">
          <header class="onboarding__card-header">
            <h3 class="onboarding__card-title">Classic token</h3>
            <Badge tone="success">Recommended</Badge>
          </header>
          <p>
            Sees every repository you can access, with full CI status. It needs the{' '}
            <code>repo</code> scope, and <code>read:org</code> to find your teams’ review requests;
            the link selects both for you.
          </p>
          <GitHubLink href={TOKEN_URLS.classic}>Create a classic token</GitHubLink>
        </article>

        <article class="onboarding__card">
          <header class="onboarding__card-header">
            <h3 class="onboarding__card-title">Fine-grained token</h3>
            <Badge tone="attention">Limited</Badge>
          </header>
          <p>
            Covers one account or organization and the repositories you pick. Grant Pull requests,
            Contents and Actions (read and write, to approve, merge and re-run checks) and Commit
            statuses (read), plus Members (read) on an organization to find its teams. GitHub does
            not offer the Checks permission to fine-grained tokens, so CI status can be missing.
          </p>
          <GitHubLink href={TOKEN_URLS.fineGrained}>Create a fine-grained token</GitHubLink>
        </article>
      </section>
    </div>
  );
}
