import { countMessage, formatNumber, t } from '../../lib/i18n';
import type { Snapshot } from '../../lib/model';
import { formatRelativeTime } from '../../lib/time/relative';
import { turnSummary } from '../../lib/turn/whoseTurn';
import './TurnSummary.css';

/** One or two sentences above the "Your turn" list: the queue, and the viewer's stuck PRs. */
export function TurnSummary({ snapshot, now }: { snapshot: Snapshot; now: number }) {
  const { waiting, oldest, stuck } = turnSummary(snapshot, now);
  if (waiting === 0 && stuck === 0) return null;
  return (
    <p class="turn-summary">
      {oldest &&
        waiting > 0 &&
        t('turnSummaryWaiting', formatNumber(waiting), formatRelativeTime(oldest, now))}{' '}
      {stuck > 0 && countMessage(stuck, 'turnSummaryStuckOne', 'turnSummaryStuckOther')}
    </p>
  );
}
