import type { AuthState } from '../model';
import { getItem, withLock } from './storage';

/** Short critical sections shared by panel and worker; never hold this during GitHub reads. */
export const SESSION_LOCK = 'prowl:session';

/** GitHub logins ignore case: whether `login` names the account of `viewer`. */
export const sameLogin = (login: string | undefined, viewer: string): boolean =>
  login?.toLowerCase() === viewer.toLowerCase();

export function withSignedIn<T>(auth: AuthState, task: () => Promise<T>): Promise<T | undefined> {
  return withLock(SESSION_LOCK, async () =>
    (await getItem('auth'))?.token === auth.token ? task() : undefined,
  );
}
