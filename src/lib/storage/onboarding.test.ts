import { describe, expect, it } from 'vitest';
import { finishSetup, initializeOnboarding, saveSetupStep } from './onboarding';
import { getItem, setItem } from './storage';

const state = () => getItem('onboarding');

describe('first-run setup initialization', () => {
  it('starts on a fresh installation and persists progress through updates', async () => {
    await initializeOnboarding('install');
    expect(await state()).toEqual({ status: 'pending', nextStep: 0 });
    await saveSetupStep(1);
    await initializeOnboarding('update');
    expect(await state()).toEqual({ status: 'pending', nextStep: 1 });
  });

  it('does not interrupt existing installations on extension update', async () => {
    await initializeOnboarding('update');
    expect(await state()).toEqual({ status: 'completed', nextStep: 0 });
    await initializeOnboarding('install');
    expect(await state()).toEqual({ status: 'completed', nextStep: 0 });
  });

  it('does not reset progress on startup or other install reasons', async () => {
    await initializeOnboarding('chrome_update');
    expect(await state()).toBeUndefined();
  });

  it('keeps completed or skipped state and never resumes those automatically', async () => {
    await setItem('onboarding', { status: 'pending', nextStep: 2 });
    await finishSetup('skipped');
    await saveSetupStep(1);
    expect(await state()).toEqual({ status: 'skipped', nextStep: 0 });
    await finishSetup('completed');
    expect(await state()).toEqual({ status: 'completed', nextStep: 0 });
  });
});
