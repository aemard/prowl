/** Merge-state refreshes and priority hints, serialized with scheduled polls. */
import { diffSnapshots } from '../lib/diff/diffSnapshots';
import { env } from '../lib/env';
import { createGitHubClient } from '../lib/github/client';
import { mapMergeState } from '../lib/github/mapPullRequest';
import { MERGE_STATE_QUERY, type MergeStateData } from '../lib/github/queries';
import { parseRateLimit } from '../lib/github/rateLimit';
import type { AuthState, PollState, Settings, Snapshot } from '../lib/model';
import { normalizePrLocal } from '../lib/storage/prLocal';
import { normalizeSettings } from '../lib/storage/settings';
import { getItem, getItems, setItem, withLock } from '../lib/storage/storage';
import { isWaiting, LOW_RATE_LIMIT, rateLimitedUntil } from '../lib/time/backoff';
import { updateBadge } from './badge';
import { notifyEvents } from './notifier';
import { IDLE, iso, recordPollFailure, stillSignedIn } from './pollState';

const consulted = new Map<string, number>();
const visibleCards = new Map<string, { ids: string[]; at: number }>();

export function clearMergePriority(): void {
  visibleCards.clear();
}

/** Per-document hints expire if a panel closes without sending its cleanup message. */
export function setMergePriority(document: string, ids: string[]): void {
  if (ids.length === 0) visibleCards.delete(document);
  else visibleCards.set(document, { ids, at: Date.now() });
}

export function mergePriority(): string[] {
  for (const [document, entry] of visibleCards) {
    if (Date.now() - entry.at > 60_000) visibleCards.delete(document);
  }
  return [
    ...new Set([...consulted.keys(), ...[...visibleCards.values()].flatMap(({ ids }) => ids)]),
  ];
}

/**
 * Refresh one consulted card, serialized with polls and other card reads. A recent read is
 * shared across panels/reopens; head and account checks drop results overtaken by changes.
 */
export async function refreshMergeState(id: string, headSha: string): Promise<void> {
  const requestedAuth = await getItem('auth');
  if (!requestedAuth) return;
  consulted.set(id, (consulted.get(id) ?? 0) + 1);
  try {
    await withLock('prowl:poll', () => refreshCard(id, headSha, requestedAuth));
  } finally {
    const remaining = (consulted.get(id) ?? 1) - 1;
    if (remaining) consulted.set(id, remaining);
    else consulted.delete(id);
  }
}

async function refreshCard(id: string, headSha: string, requestedAuth: AuthState): Promise<void> {
  const stored = await getItems(['auth', 'snapshot', 'pollState', 'settings']);
  const { auth, snapshot } = stored;
  const pr = snapshot?.pullRequests[id];
  const { mergePending: _pending, ...state } = stored.pollState ?? IDLE;
  // No poll can still be running under this lock, including after a worker restart.
  state.inFlight = false;
  const now = Date.now();
  if (
    auth?.token !== requestedAuth.token ||
    !snapshot ||
    !pr ||
    pr.state !== 'open' ||
    snapshot.viewer.login !== auth.viewer.login ||
    pr.headSha !== headSha ||
    state.lastError?.kind === 'unauthorized' ||
    isWaiting(state.nextAllowedAt, now)
  )
    return;
  const readAt = snapshot.mergeStateAt?.[id];
  if (
    readAt &&
    now - Date.parse(readAt) < 60_000 &&
    pr.mergeable !== 'unknown' &&
    pr.mergeStateStatus !== 'unknown'
  )
    return;
  await readMergeState(auth, id, headSha, state, normalizeSettings(stored.settings), now);
}

async function readMergeState(
  auth: AuthState,
  id: string,
  headSha: string,
  state: PollState,
  settings: Settings,
  now: number,
): Promise<void> {
  try {
    await setItem('pollState', { ...state, mergePending: [id] });
    const client = createGitHubClient({ token: auth.token, apiUrl: env.apiUrl });
    const data = await client.graphql<MergeStateData>(
      MERGE_STATE_QUERY,
      { ids: [id] },
      { partial: true },
    );
    if (!(await stillSignedIn(auth))) return;
    if (!(await publishMergeState(auth, id, headSha, data.nodes?.[0], settings))) return;
    if (!(await stillSignedIn(auth))) return;
    const rateLimit = parseRateLimit(data.rateLimit) ?? state.rateLimit;
    await setItem('pollState', {
      ...state,
      rateLimit,
      nextAllowedAt:
        rateLimit && rateLimit.remaining < LOW_RATE_LIMIT
          ? iso(rateLimitedUntil(now, { resetAt: rateLimit.resetAt, retryAfterSeconds: null }))
          : state.nextAllowedAt,
    });
  } catch (error) {
    if (!(await stillSignedIn(auth))) return;
    await recordPollFailure(error, state, now, settings.pollIntervalMinutes);
  } finally {
    // Head changes, missing nodes and failures must also remove the card's indicator.
    if (await stillSignedIn(auth)) {
      const latest = await getItem('pollState');
      if (latest?.mergePending) {
        const { mergePending: _pending, ...idle } = latest;
        await setItem('pollState', idle);
      }
    }
  }
}

async function publishMergeState(
  auth: AuthState,
  id: string,
  headSha: string,
  node: NonNullable<MergeStateData['nodes']>[number] | undefined,
  settings: Settings,
): Promise<boolean> {
  const latest = await getItem('snapshot');
  const latestPr = latest?.pullRequests[id];
  // A sign-out or a changed snapshot must never be replaced by this older read.
  if (
    !latest ||
    !latestPr ||
    latestPr.state !== 'open' ||
    latest.viewer.login !== auth.viewer.login ||
    latestPr.headSha !== headSha
  )
    return false;
  if (node && node.id === id) {
    const next: Snapshot = {
      ...latest,
      pullRequests: { ...latest.pullRequests, [id]: { ...latestPr, ...mapMergeState(node) } },
      mergeStateAt: { ...latest.mergeStateAt, [id]: new Date().toISOString() },
    };
    await setItem('snapshot', next);
    await updateBadge();
    await notifyEvents(
      diffSnapshots(latest, next, auth.viewer.login),
      settings.notifications,
      normalizePrLocal(await getItem('prLocal')),
    );
  }
  return true;
}
