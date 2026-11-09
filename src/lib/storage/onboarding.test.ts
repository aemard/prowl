import { describe, expect, it } from 'vitest';
import { dismissFirstRun, initializeOnboarding, normalizeOnboarding } from './onboarding';
import { getItem } from './storage';

describe('install-local first-run marker', () => {
  it('marks only fresh installs pending', async () => {
    await initializeOnboarding('install');
    expect(await getItem('onboarding')).toEqual({ status: 'pending' });
    await dismissFirstRun();
    await initializeOnboarding('update');
    expect(await getItem('onboarding')).toEqual({ status: 'completed' });
  });
  it('never shows the note for an existing installation', async () => {
    await initializeOnboarding('update');
    expect(await getItem('onboarding')).toEqual({ status: 'completed' });
  });
  it('ignores legacy progress while keeping pending notices', () => {
    const legacy = { status: 'pending' as const, nextStep: 2 };
    expect(normalizeOnboarding(legacy)).toEqual({ status: 'pending' });
  });
});
