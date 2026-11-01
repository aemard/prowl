/** Hash routes: signed-out users see sign-in; pending first-run setup gates the PR list. */
import { computed, signal } from '@preact/signals';
import { auth, onboarding } from './store';

export type Route = 'list' | 'settings' | 'onboarding' | 'setup';

const HASHES: Record<Route, string> = {
  list: '#/',
  settings: '#/settings',
  onboarding: '#/onboarding',
  setup: '#/setup',
};

/** A pending install must finish or skip setup. The explicit setup hash also permits a rerun. */
export function resolveRoute(hash: string, signedIn: boolean, pendingSetup = false): Route {
  if (!signedIn) return 'onboarding';
  if (pendingSetup || hash === HASHES.setup) return 'setup';
  if (hash === HASHES.onboarding) return 'onboarding';
  return hash === HASHES.settings ? 'settings' : 'list';
}

const hash = signal(location.hash);
window.addEventListener('hashchange', () => {
  hash.value = location.hash;
});

export const route = computed(() =>
  resolveRoute(hash.value, auth.value !== undefined, onboarding.value?.status === 'pending'),
);

export function navigate(to: Route): void {
  location.hash = HASHES[to];
  // hashchange is delivered later; switch views immediately.
  hash.value = location.hash;
}
