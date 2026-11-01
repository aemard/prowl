/** Hash routes: `#/` the list, `#/settings`, `#/onboarding`. Signed-out users only see onboarding. */
import { computed, signal } from '@preact/signals';
import { auth } from './store';

export type Route = 'list' | 'settings' | 'onboarding';

const HASHES: Record<Route, string> = {
  list: '#/',
  settings: '#/settings',
  onboarding: '#/onboarding',
};

/** Which view a hash shows: onboarding is forced while signed out, unknown hashes mean the list. */
export function resolveRoute(hash: string, signedIn: boolean): Route {
  if (!signedIn || hash === HASHES.onboarding) return 'onboarding';
  return hash === HASHES.settings ? 'settings' : 'list';
}

const hash = signal(location.hash);
window.addEventListener('hashchange', () => {
  hash.value = location.hash;
});

export const route = computed(() => resolveRoute(hash.value, auth.value !== undefined));

export function navigate(to: Route): void {
  location.hash = HASHES[to];
  // `hashchange` is dispatched as a later task; update now so the view switches in this frame.
  hash.value = location.hash;
}
