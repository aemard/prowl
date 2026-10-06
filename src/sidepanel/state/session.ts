/** Signing in and out: what the panel owns of it (the worker reacts to the messages). */
import { type AuthState, STORAGE_KEYS } from '../../lib/model';
import { removeItems, setItem } from '../../lib/storage/storage';
import { sendToBackground } from './background';
import { navigate } from './router';

/** Stores the validated sign-in, asks the worker for the first poll and shows the list. */
export async function completeSignIn(auth: AuthState): Promise<void> {
  await setItem(STORAGE_KEYS.auth, auth);
  void sendToBackground({ type: 'poll', force: true });
  navigate('list');
}

/**
 * Forgets the account: the token and everything fetched with it. The route follows `auth` to
 * onboarding on its own; the worker clears its alarms, badge and notifications on `signedOut`.
 */
export async function signOut(): Promise<void> {
  await removeItems(STORAGE_KEYS.auth, STORAGE_KEYS.snapshot, STORAGE_KEYS.pollState);
  await sendToBackground({ type: 'signedOut' });
}
