import { t } from '../../lib/i18n';
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

/**
 * The card's "More actions" menu: open, copy branch, snooze or unsnooze, mute or unmute, and the
 * GitHub actions that need no dialog (re-run failed checks, draft toggle). Snooze and mute are
 * local only (`prLocal`), so they never reach GitHub.
 */
export function PrMenu({ pr, now }: { pr: PullRequest; now: number }) {
  const local = prLocal.value;
  const snoozed = isSnoozed(local, pr.id, now);
  const muted = isMuted(local, pr.id);
  const viewer = auth.value?.viewer.login ?? '';
  const busy = pendingActions.value[pr.id] !== undefined;
  const ref = prRef(pr);

  const items: MenuEntry[] = [
    {
      id: 'open',
      label: t('openInGithub'),
      icon: <LinkExternalIcon />,
      onSelect: () => void openGitHubUrl(pr.url),
    },
    {
      id: 'copy',
      label: t('copyBranchName'),
      hint: pr.headRefName,
      icon: <CopyIcon />,
      onSelect: () =>
        void copy(pr.headRefName).then((ok) =>
          showToast(
            !ok
              ? { message: t('couldNotCopyTheBranchName'), tone: 'danger' }
              : isRiskyBranchName(pr.headRefName)
                ? {
                    message: t('copiedButThisBranchNameContainsShellCharactersQuote'),
                    tone: 'danger',
                    durationMs: 10_000,
                  }
                : { message: t('copied', pr.headRefName), tone: 'success' },
          ),
        ),
    },
    'separator',
    ...(snoozed
      ? [
          {
            id: 'unsnooze',
            label: t('unsnooze'),
            icon: <ClockIcon />,
            onSelect: () => void updatePrLocal((state) => unsnooze(state, pr.id)),
          },
        ]
      : SNOOZE_PRESETS.map((preset) => ({
          id: `snooze-${preset}`,
          label: t('snooze', snoozeLabel(preset)),
          icon: <ClockIcon />,
          onSelect: () => {
            const until = snoozeUntil(preset, Date.now());
            void updatePrLocal((state) => snooze(state, pr.id, until));
            showToast({ message: t('snoozed', ref), tone: 'info' });
          },
        }))),
    {
      id: 'mute',
      label: muted ? t('unmuteNotifications') : t('muteNotifications'),
      icon: muted ? <BellIcon /> : <BellSlashIcon />,
      onSelect: () => void updatePrLocal((state) => (muted ? unmute : mute)(state, pr.id)),
    },
  ];

  const github: MenuEntry[] = [];
  if (canRerun(pr)) {
    github.push({
      id: 'rerun',
      label: RERUN,
      icon: <SyncIcon />,
      disabled: busy,
      onSelect: () => void rerun(pr),
    });
  }
  if (canToggleDraft(pr, viewer)) {
    github.push({
      id: 'draft',
      label: draftActionName(pr),
      icon: pr.isDraft ? <GitPullRequestIcon /> : <GitPullRequestDraftIcon />,
      disabled: busy,
      onSelect: () => void toggleDraft(pr),
    });
  }
  if (github.length > 0) items.push('separator', ...github);

  return (
    <Menu
      align="end"
      items={items}
      label={t('actionsFor', ref)}
      trigger={(props) => (
        <IconButton
          {...props}
          class="pr-card__menu"
          size="sm"
          label={t('moreActionsFor', pr.title)}
        >
          <KebabHorizontalIcon />
        </IconButton>
      )}
    />
  );
}
