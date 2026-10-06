import { nodesResponse, searchResponse } from '../fixtures/github';
import { expect, test } from './fixtures';
import { authored } from './helpers/listData';

/** First list render from the cached snapshot, measured from navigation start (ms). */
const BUDGET_MS = 150;

test('renders the cached list fast, before any network call', async ({
  context,
  github,
  signIn,
  poll,
  openPanel,
}) => {
  github.onGraphQL('ProwlSearch', (variables) => searchResponse(authored, variables));
  github.onGraphQL('ProwlNodes', (variables) => nodesResponse(variables.ids, []));
  await signIn();
  await poll();
  for (const page of context.pages()) if (page.url().includes('/sidepanel/')) await page.close();

  const timings: number[] = [];
  for (let run = 0; run < 3; run++) {
    const before = github.requests.length;
    const panel = await openPanel();
    const startTime = await panel.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const find = () => performance.getEntriesByName('prowl:list-rendered')[0]?.startTime;
          const poll = () => {
            const time = find();
            if (time === undefined) requestAnimationFrame(poll);
            else resolve(time);
          };
          poll();
        }),
    );
    timings.push(startTime);
    // Opening the panel renders from storage; it does not wait for (or make) a GitHub call.
    expect(github.requests.slice(before).filter((r) => r.operationName === 'ProwlSearch')).toEqual(
      [],
    );
    await panel.close();
  }
  test.info().annotations.push({ type: 'list-render-ms', description: timings.join(', ') });
  console.log(`first list render (ms): ${timings.map((t) => t.toFixed(0)).join(', ')}`);
  // The best of three keeps one-off scheduler hiccups on shared CI runners out of the verdict.
  expect(Math.min(...timings)).toBeLessThanOrEqual(BUDGET_MS);
});
