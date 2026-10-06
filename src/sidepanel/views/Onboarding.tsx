import { MarkGithubIcon } from '../components/icons';
import { EmptyState } from '../components/ui/EmptyState';

/** Shown while signed out. US-011 adds the token form. */
export function OnboardingView() {
  return (
    <EmptyState
      icon={<MarkGithubIcon size={24} />}
      title="Sign in with GitHub"
      description="Prowl reads your pull requests with a GitHub token. Everything stays in your browser."
    />
  );
}
