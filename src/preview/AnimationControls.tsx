import { useState } from 'preact/hooks';
import { poll } from '../background/poller';
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestIcon,
} from '../sidepanel/components/icons';
import { Button } from '../sidepanel/components/ui/Button';
import type { ActivityKind } from '../sidepanel/state/prActivity';
import { simulatePullRequest } from './mockApi';

const EVENTS = [
  { kind: 'new', label: 'New PR', Icon: GitPullRequestIcon },
  { kind: 'merged', label: 'Merge PR', Icon: GitMergeIcon },
  { kind: 'closed', label: 'Close PR', Icon: GitPullRequestClosedIcon },
] as const;

export function AnimationControls() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trigger = async (kind: Exclude<ActivityKind, 'fade'>) => {
    setBusy(true);
    setError('');
    try {
      if (!simulatePullRequest(kind)) {
        simulatePullRequest('new');
        await poll({ force: true });
        simulatePullRequest(kind);
      }
      await poll({ force: true });
    } catch {
      setError('Could not simulate the update. Reload to try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="preview-controls" aria-label="Test PR animations">
      <span class="preview-controls__label">Try an update</span>
      <div class="preview-controls__buttons">
        {EVENTS.map(({ kind, label, Icon }) => (
          <Button
            key={kind}
            size="sm"
            icon={<Icon size={12} />}
            disabled={busy}
            onClick={() => void trigger(kind)}
          >
            {label}
          </Button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
