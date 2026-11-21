import type { JSX } from 'preact';
import { useId, useState } from 'preact/hooks';
import { countMessage, formatNumber, type MessageKey, t } from '../../lib/i18n';
import type { PullRequest, Snapshot, TurnReason } from '../../lib/model';
import { type StackState, stackState, stackSummary } from '../../lib/stacks';
import { TURN_LABELS, turnIn } from '../../lib/turn/whoseTurn';
import { openStacks, toggleStack } from '../state/stacks';
import { GitHubLink } from './GitHubLink';
import { BellIcon, ChevronDownIcon, ChevronUpIcon } from './icons';
import { StackIcon } from './icons/StackIcon';
import { StackMergeDialog } from './StackMergeDialog';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import './StackItem.css';

const STATES: { state: StackState; label: MessageKey }[] = [
  { state: 'ready', label: 'stackReady' },
  { state: 'progress', label: 'stackProgress' },
  { state: 'blocked', label: 'stackBlocked' },
  { state: 'draft', label: 'stackDrafts' },
];
const RED: ReadonlySet<TurnReason> = new Set(['ci_failed', 'changes_requested']);

/** What waits on the viewer in the stack, one chip per reason: "Review 2", "Fix CI · #2473". */
function turnChips(snapshot: Snapshot, members: PullRequest[]) {
  const byReason = new Map<TurnReason, PullRequest[]>();
  for (const pr of members) {
    const turn = turnIn(snapshot, pr);
    if (turn.owner === 'you' && TURN_LABELS[turn.reason])
      byReason.set(turn.reason, [...(byReason.get(turn.reason) ?? []), pr]);
  }
  return [...byReason].map(([reason, prs]) => {
    const label = t(TURN_LABELS[reason] as MessageKey);
    return {
      reason,
      text:
        prs.length === 1 ? `${label} · #${prs[0]?.number}` : `${label} ${formatNumber(prs.length)}`,
    };
  });
}

export interface StackItemProps {
  /** Bottom (position 1) to top, as `listItems` gives them. */
  members: PullRequest[];
  snapshot: Snapshot;
  /** Renders one member as the list's card. */
  card: (pr: PullRequest) => JSX.Element;
}

/**
 * A GitHub stack as one item of the list: what it is, how far it got, what waits on you, and
 * Merge for the ready run at the bottom. Opened, it lists its members top to bottom, each the
 * usual card with its details, on a numbered rail down to the base branch.
 */
export function StackItem({ members, snapshot, card }: StackItemProps) {
  const listId = useId();
  const first = members[0];
  if (!first?.stack) return null;
  const { id, number, size, base } = first.stack;
  const open = openStacks.value.includes(id);
  const { counts, mergeable } = stackSummary(members);
  const top = mergeable.at(-1);
  const summary = STATES.map(
    ({ state, label }) => `${formatNumber(counts[state])} ${t(label)}`,
  ).join(', ');
  return (
    <li class="stack-item" data-stack-id={id}>
      <div class="stack-item__head">
        <span class="stack-item__tile">
          <StackIcon />
        </span>
        <span class="stack-item__meta">
          {t(
            'stackHeading',
            first.repo.nameWithOwner,
            String(number),
            countMessage(size, 'pullCountOne', 'pullCountOther'),
            base,
          )}
        </span>
        <IconButton
          size="sm"
          label={t(open ? 'stackHide' : 'stackShow', String(number))}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => toggleStack(id)}
        >
          {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </IconButton>
      </div>
      <GitHubLink class="stack-item__title" href={first.url}>
        {size > 1 ? t('stackTitle', first.title, formatNumber(size - 1)) : first.title}
      </GitHubLink>
      <div class="stack-item__bar" role="img" aria-label={t('stackBar', String(number), summary)}>
        {members.map((pr) => (
          <span key={pr.id} data-state={stackState(pr)} />
        ))}
      </div>
      <dl class="stack-item__counts">
        {STATES.map(({ state, label }) => (
          <div key={state} data-state={state}>
            <dt>{t(label)}</dt>
            <dd>{formatNumber(counts[state])}</dd>
          </div>
        ))}
      </dl>
      <TurnChips snapshot={snapshot} members={members} />
      {open && (
        <>
          <ol id={listId} class="pr-list stack-item__list" reversed>
            {[...members].reverse().map(card)}
          </ol>
          {members.length < size && (
            <p class="stack-item__note">
              {countMessage(size - members.length, 'stackMissingOne', 'stackMissing')}
            </p>
          )}
          <p class="stack-item__base">{t('stackBase', base)}</p>
        </>
      )}
      {top?.viewerCanMerge && <StackMerge members={mergeable} top={top} size={size} />}
    </li>
  );
}

function TurnChips({ snapshot, members }: { snapshot: Snapshot; members: PullRequest[] }) {
  const chips = turnChips(snapshot, members);
  if (chips.length === 0) return null;
  return (
    <span class="pr-card__chips">
      {chips.map(({ reason, text }) => (
        <Badge
          key={reason}
          tone={RED.has(reason) ? 'danger' : 'accent'}
          variant="plain"
          icon={<BellIcon size={12} />}
          title={t('yourTurnSection')}
        >
          {text}
        </Badge>
      ))}
    </span>
  );
}

/** The ready run at the bottom: how many can merge, and Merge behind its confirmation. */
function StackMerge({
  members,
  top,
  size,
}: {
  members: PullRequest[];
  top: PullRequest;
  size: number;
}) {
  const [merging, setMerging] = useState(false);
  const why = useId();
  const all = members.length === size;
  const count = formatNumber(members.length);
  return (
    <div class="stack-item__merge">
      <span id={why}>{all ? t('stackCanMergeAll') : t('stackCanMerge', count)}</span>
      <span id={`${why}-what`} hidden>
        {t('stackMergeAria', count, String(top.stack?.number))}
      </span>
      <Button
        variant="primary"
        size="sm"
        aria-describedby={`${why}-what`}
        onClick={() => setMerging(true)}
      >
        {all ? t('stackMergeAll') : t('stackMergeSome', count, formatNumber(size))}
      </Button>
      {merging && (
        <StackMergeDialog
          members={members}
          top={top}
          size={size}
          onClose={() => setMerging(false)}
        />
      )}
    </div>
  );
}
