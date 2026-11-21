/** `ProwlPullRequestText` answers (the on-device AI's read), for unit tests and the E2E mock. */
import type { TextData } from '../../src/lib/github/fetchPullRequestText';

type TextNode = NonNullable<TextData['node']>;
type Context = NonNullable<
  NonNullable<
    NonNullable<NonNullable<TextNode['commits']>['nodes']>[number]
  >['commit']['statusCheckRollup']
>['contexts'];

/** A failing check run with a report and one annotation. */
export const failingRunText = (name = 'test', message = 'expected 2, got 3') => ({
  __typename: 'CheckRun' as const,
  name,
  conclusion: 'FAILURE',
  title: '1 test failed',
  summary: 'widget.test.ts failed',
  text: null,
  annotations: {
    nodes: [
      {
        path: 'src/widget.ts',
        message,
        annotationLevel: 'FAILURE',
        location: { start: { line: 12 } },
      },
    ],
  },
});

export function textNode(
  overrides: Partial<TextNode> = {},
  contexts: NonNullable<Context>['nodes'] = [],
): TextNode {
  return {
    title: 'Improve widget',
    bodyText: 'Makes the widget faster.',
    comments: { nodes: [{ author: { login: 'bob' }, bodyText: 'Can you add a test?' }] },
    reviews: { nodes: [{ author: { login: 'carol' }, state: 'APPROVED', bodyText: 'LGTM' }] },
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: contexts } } } }] },
    ...overrides,
  };
}
