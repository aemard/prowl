/**
 * The words of a pull request, for the on-device AI: its description, latest comments and
 * reviews, and what its failing checks reported. Read on demand from an expanded card (never
 * polled, never stored), plain text only (`bodyText`), each item clipped; the on-device AI fits
 * the whole to its model's input quota (`fitInput`), newest discussion first.
 */
import { t } from '../i18n';
import type { GitHubClient } from './client';
import { GitHubError } from './errors';
import { RATE_LIMIT_FIELDS } from './rateLimit';

export const TEXT_QUERY = /* GraphQL */ `
query ProwlPullRequestText($id: ID!) {
  node(id: $id) {
    ... on PullRequest {
      title
      bodyText
      comments(last: 15) { nodes { author { login } bodyText createdAt } }
      reviews(last: 10) { nodes { author { login } state bodyText createdAt } }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 50) {
                nodes {
                  __typename
                  ... on CheckRun {
                    name conclusion title summary text
                    annotations(first: 20) { nodes { path message annotationLevel location { start { line } } } }
                  }
                  ... on StatusContext { context state description }
                }
              }
            }
          }
        }
      }
    }
  }
  ${RATE_LIMIT_FIELDS}
}`;

type Nodes<T> = { nodes: (T | null)[] | null } | null | undefined;
interface Said {
  author: { login: string } | null;
  bodyText: string;
  createdAt?: string;
  state?: string;
}
interface Annotation {
  path: string;
  message: string;
  annotationLevel: string | null;
  location: { start: { line: number } } | null;
}
type Context =
  | {
      __typename: 'CheckRun';
      name: string;
      conclusion: string | null;
      title: string | null;
      summary: string | null;
      text: string | null;
      annotations: Nodes<Annotation>;
    }
  | { __typename: 'StatusContext'; context: string; state: string; description: string | null };
export interface TextData {
  node: {
    title?: string;
    bodyText?: string;
    comments?: Nodes<Said>;
    reviews?: Nodes<Said>;
    commits?: Nodes<{ commit: { statusCheckRollup: { contexts: Nodes<Context> } | null } }>;
  } | null;
}

/** What the AI reads: the conversation, and the reports of the failing checks. */
export interface PullRequestText {
  /** Title and description. */
  description: string;
  /** Comments and reviews, oldest first, one `author (kind): text` each. */
  discussion: string[];
  /** One block per failing check: its name, title, summary and annotations. */
  failures: string[];
}

const MAX_ITEM = 1_500;
const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text.trim();
const present = <T>(connection: Nodes<T>): T[] =>
  (connection?.nodes ?? []).filter((node): node is T => node !== null);

function failureOf(context: Context): string | null {
  if (context.__typename === 'StatusContext')
    return FAILED.has(context.state)
      ? `${context.context}: ${context.description ?? context.state}`
      : null;
  if (!FAILED.has(context.conclusion ?? '')) return null;
  const notes = present(context.annotations).map(
    (a) => `- ${a.path}${a.location ? `:${a.location.start.line}` : ''}: ${a.message}`,
  );
  return [context.name, context.title, context.summary, context.text, ...notes]
    .filter(Boolean)
    .map((line) => clip(line ?? '', MAX_ITEM))
    .join('\n');
}

/** Maps `ProwlPullRequestText`; exported for tests. */
export function mapPullRequestText(node: NonNullable<TextData['node']>): PullRequestText {
  const said = (kind: string) => (item: Said) =>
    item.bodyText.trim()
      ? `${item.author?.login ?? 'ghost'} (${kind}): ${clip(item.bodyText, MAX_ITEM)}`
      : '';
  // Comments and reviews interleaved by date, so trimming the oldest keeps the latest exchange.
  const discussion = [
    ...present(node.comments).map((c) => ({ at: c.createdAt, text: said('comment')(c) })),
    ...present(node.reviews).map((r) => ({
      at: r.createdAt,
      text: said(`review, ${(r.state ?? '').toLowerCase()}`)(r),
    })),
  ]
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
    .flatMap(({ text }) => text || []);
  const contexts = present(node.commits).flatMap((c) =>
    present(c.commit.statusCheckRollup?.contexts),
  );
  return {
    description: [node.title ?? '', clip(node.bodyText ?? '', MAX_ITEM * 2)]
      .filter(Boolean)
      .join('\n\n'),
    discussion,
    failures: contexts.flatMap((context) => failureOf(context) ?? []),
  };
}

/** Reads the text of pull request `id`. Throws `GitHubError` (`not_found` when it is gone). */
export async function fetchPullRequestText(
  client: GitHubClient,
  id: string,
): Promise<PullRequestText> {
  const { node } = await client.graphql<TextData>(TEXT_QUERY, { id }, { partial: true });
  if (!node || !('bodyText' in node))
    throw new GitHubError('not_found', t('thisPullRequestIsNotAvailable'));
  return mapPullRequestText(node);
}
