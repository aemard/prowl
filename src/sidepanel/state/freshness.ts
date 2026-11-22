/**
 * Opening the panel (or coming back to it) asks the worker for a `panel` poll instead of showing
 * the list until the next scheduled one: after days with Chrome closed or the computer asleep,
 * the user sees current data within seconds. The worker's cadence policy decides: it polls a
 * list older than a minute, and never through a backoff, a rate-limit wait or a rejected token
 * (only an explicit Refresh does that).
 */
import { useEffect } from 'preact/hooks';
import { sendToBackground } from './background';
import { auth, pollState } from './store';

/** Asks the worker for a `panel` poll when signed in and no poll runs. */
export function refreshIfStale(): void {
  if (!auth.value || pollState.value?.inFlight) return;
  void sendToBackground({ type: 'poll', reason: 'panel' });
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
