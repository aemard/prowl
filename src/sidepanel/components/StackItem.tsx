import type { JSX } from 'preact';
import { useId } from 'preact/hooks';
import { countMessage, formatNumber, type MessageKey, t } from '../../lib/i18n';
import type { PullRequest, Snapshot, TurnReason } from '../../lib/model';
import { type StackState, stackState, stackSummary } from '../../lib/stacks';
import { TURN_LABELS, turnIn } from '../../lib/turn/whoseTurn';
import { openStacks, toggleStack } from '../state/stacks';
import { GitHubLink } from './GitHubLink';
import { BellIcon, ChevronDownIcon, ChevronUpIcon } from './icons';
import { StackIcon } from './icons/StackIcon';
import { StackMergeButton, type StackMergeTarget } from './StackMergeDialog';
import { Badge } from './ui/Badge';
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
  /** Every member Prowl knows, from all sections, bottom (position 1) to top (`stackMembers`). */
  members: PullRequest[];
  /** The members this section shows (after the filter), as `listItems` gives them. */
  shown: PullRequest[];
  snapshot: Snapshot;
  /** Renders one member as the list's card. */
  card: (pr: PullRequest) => JSX.Element;
}

/**
 * A GitHub stack as one item of the list: what it is, how far it got, what waits on you, and
 * Merge for the ready run at the bottom, all counted over every member Prowl knows. Opened, it
 * lists the members this section shows top to bottom, each the usual card with its details, on
 * a numbered rail down to the base branch, and says how many are elsewhere or unknown.
 */
export function StackItem({ members, shown, snapshot, card }: StackItemProps) {
  const listId = useId();
  const first = members[0];
  if (!first?.stack) return null;
  const { id, base } = first.stack;
  const number = formatNumber(first.stack.number);
  const open = openStacks.value.includes(id);
  const { counts, mergeable, total } = stackSummary(members);
  const top = mergeable.at(-1);
  const summary = STATES.map(({ state, label }) =>
    t('stackStateCount', formatNumber(counts[state]), t(label)),
  ).join(t('listSeparator'));
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
            number,
            countMessage(total, 'pullCountOne', 'pullCountOther'),
            base,
          )}
        </span>
        <IconButton
          size="sm"
          label={t(open ? 'stackHide' : 'stackShow', number)}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => toggleStack(id)}
        >
          {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </IconButton>
      </div>
      {/* The link opens the bottom PR, so it is named by that PR alone. */}
      <p class="stack-item__title">
        <GitHubLink href={first.url}>{first.title}</GitHubLink>
        {total > 1 && t('stackAndMore', formatNumber(total - 1))}
      </p>
      <div class="stack-item__bar" role="img" aria-label={t('stackBar', number, summary)}>
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
            {[...shown].reverse().map(card)}
          </ol>
          {members.length > shown.length && (
            <p class="stack-item__note">
              {countMessage(members.length - shown.length, 'stackElsewhereOne', 'stackElsewhere')}
            </p>
          )}
          {members.length < total && (
            <p class="stack-item__note">
              {countMessage(total - members.length, 'stackMissingOne', 'stackMissing')}
            </p>
          )}
          <p class="stack-item__base">{t('stackBase', base)}</p>
        </>
      )}
      {top?.viewerCanMerge && <StackMerge members={mergeable} top={top} size={total} />}
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
          {/* The chip is a status, not a button: it says whose move it is. */}
          <span class="sr-only">{t('yourTurnPrefix')} </span>
          {text}
        </Badge>
      ))}
    </span>
  );
}

/** The ready run at the bottom: how many can merge, and Merge behind its confirmation. */
function StackMerge({ members, top, size }: StackMergeTarget) {
  const why = useId();
  const all = members.length === size;
  const count = formatNumber(members.length);
  return (
    <div class="stack-item__merge">
      <span id={why}>{all ? t('stackCanMergeAll') : t('stackCanMerge', count)}</span>
      <span id={`${why}-what`} hidden>
        {t('stackMergeAria', count, formatNumber(top.stack?.number ?? 0))}
      </span>
      <StackMergeButton members={members} top={top} size={size} aria-describedby={`${why}-what`}>
        {all ? t('stackMergeAll') : t('stackMergeSome', count, formatNumber(size))}
      </StackMergeButton>
    </div>
  );
}
