import { expect, test } from './fixtures';

test('first-time setup configures scopes and notifications then opens the list', async ({
  signIn,
  seedStorage,
  openPanel,
  expectNoA11yViolations,
}) => {
  await signIn();
  await seedStorage({ onboarding: { status: 'pending', nextStep: 0 } });
  const page = await openPanel('#/');
  await expect(page.getByRole('heading', { name: 'Your pull requests' })).toBeVisible();
  await page.getByRole('switch', { name: 'Review requested' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await page.getByRole('switch', { name: 'Desktop notifications' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Open my pull requests' }).click();
  await expect(page.getByRole('main', { name: 'Pull requests' })).toBeVisible();
  const state = await page.evaluate(async () => {
    const stored = await chrome.storage.local.get(['onboarding', 'settings']);
    return {
      onboarding: stored.onboarding,
      settings: stored.settings as {
        sections: { kind: string; enabled: boolean }[];
        notifications: { enabled: boolean };
      },
    };
  });
  expect(state.onboarding).toEqual({ status: 'completed', nextStep: 0 });
  expect(
    state.settings.sections.find((s: { kind: string }) => s.kind === 'review_requested')?.enabled,
  ).toBe(true);
  expect(state.settings.notifications.enabled).toBe(true);
});

test('skipping setup preserves defaults and does not show setup again', async ({
  signIn,
  seedStorage,
  openPanel,
}) => {
  await signIn();
  await seedStorage({ onboarding: { status: 'pending', nextStep: 0 } });
  const page = await openPanel();
  await page.getByRole('button', { name: 'Skip setup' }).click();
  await expect(page.getByRole('main', { name: 'Pull requests' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('main', { name: 'Pull requests' })).toBeVisible();
  const status = await page.evaluate(async () => {
    const stored = await chrome.storage.local.get('onboarding');
    return (stored.onboarding as { status: string }).status;
  });
  expect(status).toBe('skipped');
});

test('setup can be relaunched from Settings without resetting existing preferences', async ({
  signIn,
  openPanel,
}) => {
  await signIn();
  const page = await openPanel('#/settings');
  await page.getByRole('button', { name: 'Run setup again' }).click();
  await expect(page.getByRole('heading', { name: 'Your pull requests' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip setup' }).click();
  await expect(page.getByRole('main', { name: 'Pull requests' })).toBeVisible();
});

test('onboarding filters discovered GitHub teams before following team review requests', async ({
  signIn,
  seedStorage,
  openPanel,
  expectNoA11yViolations,
}) => {
  await signIn();
  await seedStorage({
    onboarding: { status: 'pending', nextStep: 0 },
    teams: {
      login: 'octocat',
      fetchedAt: new Date().toISOString(),
      teams: [
        { org: 'acme', slug: 'platform', name: 'Platform' },
        { org: 'acme', slug: 'security', name: 'Security' },
      ],
      error: null,
    },
  });
  const page = await openPanel();
  await page.getByRole('switch', { name: 'Team reviews' }).click();
  await expect(page.getByRole('group', { name: 'acme' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Security' })).toHaveAttribute('aria-checked', 'true');
  await expectNoA11yViolations(page);
  await page.getByRole('switch', { name: 'Security' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    return settings as {
      unfollowedTeams: string[];
      sections: { kind: string; enabled: boolean }[];
    };
  });
  expect(saved.unfollowedTeams).toEqual(['acme/security']);
  expect(saved.sections.find((section) => section.kind === 'team_review_requested')?.enabled).toBe(true);
});
