/** `ProwlReviewThreads` nodes, for unit tests and the E2E mock. */
const WEB = 'https://github.com';

export function threadNode(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    isResolved: false,
    isOutdated: false,
    path: 'src/widget.ts',
    line: 12,
    viewerCanResolve: true,
    viewerCanReply: true,
    comments: {
      totalCount: 1,
      nodes: [
        {
          author: { login: 'bob' },
          bodyText: 'Should this be a constant?',
          createdAt: '2026-10-05T10:00:00Z',
          url: `${WEB}/acme/widgets/pull/1#discussion_r${id}`,
        },
      ],
    },
    ...overrides,
  };
}

/** The `data` of a `ProwlReviewThreads` answer; `endCursor` when GitHub has another page. */
export const threadsResponse = (threads: unknown[], endCursor: string | null = null) => ({
  node: {
    reviewThreads: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes: threads },
  },
});
