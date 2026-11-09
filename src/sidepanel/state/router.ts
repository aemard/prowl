/** Hash routes: signed-out users see sign-in; signed-in users can always reach their list. */
import { computed, signal } from '@preact/signals';
import { auth } from './store';

export type Route = 'list' | 'settings' | 'onboarding';

const HASHES: Record<Route, string> = {
  list: '#/',
  settings: '#/settings',
  onboarding: '#/onboarding',
};

/** Unknown and obsolete hashes fall back to the list. */
export function resolveRoute(hash: string, signedIn: boolean): Route {
  if (!signedIn) return 'onboarding';
  if (hash === HASHES.onboarding) return 'onboarding';
  return hash === HASHES.settings ? 'settings' : 'list';
}

const hash = signal(location.hash);
window.addEventListener('hashchange', () => {
  hash.value = location.hash;
});

export const route = computed(() => resolveRoute(hash.value, auth.value !== undefined));

export function navigate(to: Route): void {
  location.hash = HASHES[to];
  // hashchange is delivered later; switch views immediately.
  hash.value = location.hash;
}
