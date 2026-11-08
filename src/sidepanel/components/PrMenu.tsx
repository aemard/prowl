import type { PullRequest } from '../../lib/model';
import {
  isMuted,
  isSnoozed,
  mute,
  snooze,
  unmute,
  unsnooze,
  updatePrLocal,
} from '../../lib/storage/prLocal';
import { SNOOZE_PRESETS, snoozeLabel, snoozeUntil } from '../../lib/time/snooze';
import { openGitHubUrl } from '../openUrl';
import { pendingActions, prRef } from '../state/prActions';
import { auth, prLocal } from '../state/store';
import {
  BellIcon,
  BellSlashIcon,
  ClockIcon,
  CopyIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  KebabHorizontalIcon,
  LinkExternalIcon,
  SyncIcon,
} from './icons';
import {
  canRerun,
  canToggleDraft,
  draftActionName,
  RERUN,
  rerun,
  toggleDraft,
} from './MaintenanceActions';
import { IconButton } from './ui/IconButton';
import { Menu, type MenuEntry } from './ui/Menu';
import { showToast } from './ui/Toast';

/**
 * Branch names are chosen by the PR's author and may hold shell syntax (`$(...)`, `;`, `|`) or
 * bidi controls that disguise them; such a name gets a warning before it reaches a terminal.
 */
export const isRiskyBranchName = (name: string) =>
  /[^\w./+@-]/.test(name) || /[\u202A-\u202E\u2066-\u2069]/.test(name);

/** Copies `text`, with a fallback for when the async clipboard is refused. */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function copyBranch(pr: PullRequest) {
  const ok = await copy(pr.headRefName);
  showToast(
    !ok
      ? { message: 'Could not copy the branch name.', tone: 'danger' }
      : isRiskyBranchName(pr.headRefName)
        ? {
            message:
              'Copied, but this branch name contains shell characters. Quote it before pasting it into a terminal.',
            tone: 'danger',
            durationMs: 10_000,
          }
        : { message: `Copied ${pr.headRefName}`, tone: 'success' },
  );
}

function localEntries(pr: PullRequest, now: number): MenuEntry[] {
  const local = prLocal.value;
  const muted = isMuted(local, pr.id);
  return [
    {
      id: 'open',
      label: 'Open in GitHub',
      icon: <LinkExternalIcon />,
      onSelect: () => void openGitHubUrl(pr.url),
    },
    {
      id: 'copy',
      label: 'Copy branch name',
      hint: pr.headRefName,
      icon: <CopyIcon />,
      onSelect: () => void copyBranch(pr),
    },
    'separator',
    ...(isSnoozed(local, pr.id, now)
      ? [
          {
            id: 'unsnooze',
            label: 'Unsnooze',
            icon: <ClockIcon />,
            onSelect: () => void updatePrLocal((state) => unsnooze(state, pr.id)),
          },
        ]
      : SNOOZE_PRESETS.map((preset) => ({
          id: `snooze-${preset}`,
          label: `Snooze ${snoozeLabel(preset)}`,
          icon: <ClockIcon />,
          onSelect: () => {
            const until = snoozeUntil(preset, Date.now());
            void updatePrLocal((state) => snooze(state, pr.id, until));
            showToast({ message: `Snoozed ${prRef(pr)}`, tone: 'info' });
          },
        }))),
    {
      id: 'mute',
      label: muted ? 'Unmute notifications' : 'Mute notifications',
      icon: muted ? <BellIcon /> : <BellSlashIcon />,
      onSelect: () => void updatePrLocal((state) => (muted ? unmute : mute)(state, pr.id)),
    },
  ];
}

function githubEntries(pr: PullRequest): MenuEntry[] {
  const viewer = auth.value?.viewer.login ?? '';
  const busy = pendingActions.value[pr.id] !== undefined;
  const items: MenuEntry[] = [];
  if (canRerun(pr)) {
    items.push({
      id: 'rerun',
      label: RERUN,
      icon: <SyncIcon />,
      disabled: busy,
      onSelect: () => void rerun(pr),
    });
  }
  if (canToggleDraft(pr, viewer)) {
    items.push({
      id: 'draft',
      label: draftActionName(pr),
      icon: pr.isDraft ? <GitPullRequestIcon /> : <GitPullRequestDraftIcon />,
      disabled: busy,
      onSelect: () => void toggleDraft(pr),
    });
  }
  return items;
}

/**
 * The card's "More actions" menu: open, copy branch, snooze or unsnooze, mute or unmute, and the
 * GitHub actions that need no dialog (re-run failed checks, draft toggle). Snooze and mute are
 * local only (`prLocal`), so they never reach GitHub.
 */
export function PrMenu({ pr, now }: { pr: PullRequest; now: number }) {
  const items = localEntries(pr, now);
  const github = githubEntries(pr);
  if (github.length > 0) items.push('separator', ...github);
  return (
    <Menu
      align="end"
      items={items}
      label={`Actions for ${prRef(pr)}`}
      trigger={(props) => (
        <IconButton
          {...props}
          class="pr-card__menu"
          size="sm"
          label={`More actions for ${pr.title}`}
        >
          <KebabHorizontalIcon />
        </IconButton>
      )}
    />
  );
}
