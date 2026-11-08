/** First-run setup is installation-local, separate from synced preferences and authentication. */
import { type OnboardingState, STORAGE_KEYS } from '../model';
import { updateItem } from './storage';

export const PENDING_SETUP: OnboardingState = { status: 'pending', nextStep: 0 };
export const COMPLETED_SETUP: OnboardingState = { status: 'completed', nextStep: 0 };

/**
 * Chrome reports install once and update for every newer extension version. Missing setup
 * on update means a legacy installation: never surprise existing users with a wizard.
 * An existing state (including progress) wins even if the extension updates mid-wizard.
 */
export async function initializeOnboarding(
  reason: chrome.runtime.InstalledDetails['reason'],
): Promise<void> {
  if (reason !== 'install' && reason !== 'update') return;
  await updateItem(
    STORAGE_KEYS.onboarding,
    (current) => current ?? (reason === 'install' ? PENDING_SETUP : COMPLETED_SETUP),
  );
}

/** Only pending setup needs a resumable step. A Settings rerun keeps its previous status. */
export async function saveSetupStep(nextStep: 0 | 1 | 2): Promise<void> {
  await updateItem(STORAGE_KEYS.onboarding, (current) =>
    current?.status === 'pending' ? { ...current, nextStep } : (current ?? COMPLETED_SETUP),
  );
}

export async function finishSetup(status: 'completed' | 'skipped'): Promise<void> {
  await updateItem(STORAGE_KEYS.onboarding, () => ({ status, nextStep: 0 }));
}
