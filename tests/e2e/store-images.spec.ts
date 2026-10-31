// Generates the marquee's real UI preview; this is artwork setup, not a list behaviour test.
// `pnpm screenshots` enables it. Regular E2E runs skip it before starting any fixtures.
import { defaultSettings } from '../../src/lib/storage/settings';
import { prId, searchResponse } from '../fixtures/github';
import { expect, saveScreenshot, test } from './fixtures';
import { authored } from './helpers/listData';

test.skip(process.env.PROWL_SCREENSHOTS !== '1', 'Only run when generating artwork');

const readyId = prId(912, 'acme/api');

test('captures a ready-to-merge pull request for the store marquee', async ({
  github,
  seedStorage,
  signIn,
  poll,
  openPanel,
}) => {
  github.onGraphQL('ProwlSearch', (variables) =>
    searchResponse(
      String(variables.query).includes('author:@me')
        ? authored.filter((node) => node.id === readyId)
        : [],
      variables,
    ),
  );
  await seedStorage({
    settings: {
      groupByRepo: false,
      sections: defaultSettings().sections.map((section) => ({
        ...section,
        enabled: section.kind !== 'team_review_requested',
      })),
    },
    prLocal: {
      snoozed: {},
      muted: {},
      seen: { [readyId]: new Date().toISOString() },
    },
  });
  await signIn();
  await poll();
  const panel = await openPanel();
  await panel.emulateMedia({ colorScheme: 'light' });
  await expect(panel.locator('.pr-card')).toHaveCount(1);
  await expect(panel.getByText('Ready to merge', { exact: true })).toBeVisible();
  await saveScreenshot(panel, 'list-ready');
});
