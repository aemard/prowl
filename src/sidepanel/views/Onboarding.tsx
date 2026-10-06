import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { signInErrorMessage, TOKEN_URLS, validatePat } from '../../lib/github/auth/pat';
import { LinkExternalIcon, MarkGithubIcon } from '../components/icons';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { TextField } from '../components/ui/TextField';
import { showToast } from '../components/ui/Toast';
import { openGitHubUrl } from '../openUrl';
import { completeSignIn } from '../state/session';
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

/** Shown while signed out: the token form and how to create a token. */
export function OnboardingView() {
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
      await completeSignIn(auth);
      if (warning) {
        showToast({ message: `Signed in as ${auth.viewer.login}. ${warning}`, durationMs: 15_000 });
      }
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
        description="Paste a personal access token. It stays in this browser and is only ever sent to GitHub."
      />

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
        <Button type="submit" variant="primary" loading={busy}>
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
            <code>repo</code> scope; the link selects it for you.
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
            statuses (read). GitHub does not offer the Checks permission to fine-grained tokens, so
            CI status can be missing.
          </p>
          <GitHubLink href={TOKEN_URLS.fineGrained}>Create a fine-grained token</GitHubLink>
        </article>
      </section>
    </div>
  );
}
