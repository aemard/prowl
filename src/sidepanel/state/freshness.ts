/**
 * Opening the panel (or coming back to it) refreshes a list older than a minute at once, instead
 * of showing it until the next scheduled poll: after days with Chrome closed or the computer
 * asleep, the user sees current data within seconds. A forced poll still honours rate limits.
 */
import { useEffect } from 'preact/hooks';
import { sendToBackground } from './background';
import { auth, pollState, snapshot } from './store';

/** A list younger than this is fresh enough to show without asking GitHub again. */
export const FRESH_MS = 60_000;

/** Asks the worker for a poll when signed in and the list is missing or older than `FRESH_MS`. */
export function refreshIfStale(now = Date.now()): void {
  if (!auth.value || pollState.value?.inFlight) return;
  const fetchedAt = snapshot.value?.fetchedAt;
  if (fetchedAt && now - Date.parse(fetchedAt) < FRESH_MS) return;
  void sendToBackground({ type: 'poll', force: true });
}

/** On mount and each time the panel becomes visible again. */
export function useRefreshOnOpen(): void {
  useEffect(() => {
    refreshIfStale();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshIfStale();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
}
