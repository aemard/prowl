import type { PanelState } from '../model';
import { isRecord } from './guards';

/** Repair local view context without carrying filters or accepting unbounded stored data. */
export function normalizePanelState(raw: unknown): PanelState | undefined {
  // Logins other than github.com's `[a-z0-9-]` exist (Managed Users have `_`): bound, don't judge.
  if (!isRecord(raw) || typeof raw.login !== 'string' || !/^[\w.-]{1,100}$/.test(raw.login))
    return undefined;
  return {
    login: raw.login.toLowerCase(),
    ...(typeof raw.activeSectionId === 'string' && /^[\w-]{1,64}$/.test(raw.activeSectionId)
      ? { activeSectionId: raw.activeSectionId }
      : {}),
    foldedGroups: Array.isArray(raw.foldedGroups)
      ? [
          ...new Set(
            raw.foldedGroups.filter(
              (key): key is string =>
                typeof key === 'string' && key.length <= 256 && key.includes('\n'),
            ),
          ),
        ].slice(0, 1000)
      : [],
  };
}
