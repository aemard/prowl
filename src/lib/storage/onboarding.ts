/** Install-local first-run notice marker; legacy progress fields are ignored. */
import { type OnboardingState, STORAGE_KEYS } from '../model';
import { updateItem } from './storage';

export const PENDING_NOTICE: OnboardingState = { status: 'pending' };
export const DISMISSED_NOTICE: OnboardingState = { status: 'completed' };

export function normalizeOnboarding(state: OnboardingState | undefined) {
  return state ? { status: state.status } : undefined;
}

export async function initializeOnboarding(
  reason: chrome.runtime.InstalledDetails['reason'],
): Promise<void> {
  if (reason !== 'install' && reason !== 'update') return;
  await updateItem(
    STORAGE_KEYS.onboarding,
    (current) =>
      normalizeOnboarding(current) ?? (reason === 'install' ? PENDING_NOTICE : DISMISSED_NOTICE),
  );
}

export async function dismissFirstRun(): Promise<void> {
  await updateItem(STORAGE_KEYS.onboarding, () => DISMISSED_NOTICE);
}
