/**
 * Search queries for the PR list: one GitHub issue-search string per section, plus the
 * repo include/exclude filters. Inputs come from `normalizeSettings`, which already validated
 * the repo patterns (`owner` or `owner/name`), so they are interpolated verbatim.
 */
import type { PullRequest, Section, Settings } from '../model';
import type { BuiltInSectionKind } from '../storage/settings';

type RepoFilters = Pick<Settings, 'repoInclude' | 'repoExclude'>;

/** `review-requested:@me` would also match the viewer's teams: they have their own section. */
const PRESET_QUALIFIER: Record<Exclude<BuiltInSectionKind, 'team_review_requested'>, string> = {
  authored: 'author:@me',
  review_requested: 'user-review-requested:@me',
  mentioned: 'mentions:@me',
  assigned: 'assignee:@me',
};

/** A positive `repo:` / `org:` / `user:` in a custom query (negated ones start with `-`). */
const OWN_SCOPE = /(?:^|[\s(])(?:repo|org|user):/i;

/**
 * `owner/name` -> `repo:`; a bare owner -> `user:`, which GitHub also accepts for
 * organizations (checked against the search API: `user:github` and `org:torvalds` both match).
 */
const scope = (pattern: string) => `${pattern.includes('/') ? 'repo' : 'user'}:${pattern}`;

/**
 * The search string for a section: `is:pr` is always enforced (AND / OR / NOT only combine
 * search words in GitHub's syntax, never qualifiers, so `is:pr` cannot be OR-ed away).
 * Presets follow the shape `is:pr is:open <who>:@me archived:false`, the team section
 * `team-review-requested:<team>` for one team key (`org/slug`); a custom query is used
 * as typed (callers skip it when `validateCustomQuery` reports errors).
 *
 * `repoInclude` adds positive scope qualifiers, which GitHub ORs together, unless the custom
 * query brings its own: then its scope wins on the server and `filterByRepo` intersects it
 * with the include list. `repoExclude` adds `-repo:` / `-user:`. GitHub ignores a scope that
 * the exclusions cancel out completely, so `filterByRepo` stays the source of truth.
 */
export function buildSearchQuery(section: Section, filters: RepoFilters, team = ''): string {
  const parts = ['is:pr'];
  let scoped = false;
  if (section.kind === 'custom') {
    const query = (section.query ?? '').trim();
    scoped = OWN_SCOPE.test(query);
    parts.push(query);
  } else {
    const who =
      section.kind === 'team_review_requested'
        ? `team-review-requested:${team}`
        : PRESET_QUALIFIER[section.kind];
    parts.push('is:open', who, 'archived:false');
  }
  if (!scoped) parts.push(...filters.repoInclude.map(scope));
  parts.push(...filters.repoExclude.map((pattern) => `-${scope(pattern)}`));
  return parts.filter(Boolean).join(' ');
}

type RepoRef = Pick<PullRequest['repo'], 'owner' | 'nameWithOwner'>;

/** Case-insensitive: a pattern is a repo's `owner` or its `owner/name`. */
function matcher(patterns: readonly string[]): (repo: RepoRef) => boolean {
  const known = new Set(patterns.map((pattern) => pattern.toLowerCase()));
  return ({ owner, nameWithOwner }) =>
    known.has(owner.toLowerCase()) || known.has(nameWithOwner.toLowerCase());
}

/**
 * Applies the repo filters to fetched PRs: kept when the include list is empty or matches,
 * then dropped when the exclude list matches. Enforces what the query could not (see above).
 */
export function filterByRepo<T extends { repo: RepoRef }>(prs: readonly T[], filters: RepoFilters) {
  const included = matcher(filters.repoInclude);
  const excluded = matcher(filters.repoExclude);
  return prs.filter(
    ({ repo }) => (filters.repoInclude.length === 0 || included(repo)) && !excluded(repo),
  );
}

// ---------------------------------------------------------------------------------------------
// Custom query validation

/** GitHub rejects (422) more than 5 AND / OR / NOT, and search words over 256 characters. */
const MAX_OPERATORS = 5;
const MAX_TEXT_LENGTH = 256;

/** An issue-only or "not a PR" filter, which would make Prowl follow nothing. */
const NOT_A_PR = /(?:^|[\s(])(?:(?:is|type):issue|-(?:is|type):(?:pr|pull-request))(?=$|[\s)])/i;

/** A qualifier (`-label:"good first issue"`, `author:@me`) or a quoted phrase or a word. */
const TOKEN = /(-?[\w.-]+:(?:"[^"]*"|\S*))|("[^"]*"|\S+)/g;

/** Operators and search words of a query: qualifiers count toward neither limit. */
function analyze(query: string): { operators: number; text: string } {
  let operators = 0;
  const words: string[] = [];
  for (const [, qualifier, word = ''] of query.replace(/[()]/g, ' ').matchAll(TOKEN)) {
    if (qualifier) continue;
    if (word === 'AND' || word === 'OR' || word === 'NOT') operators += 1;
    else words.push(word);
  }
  return { operators, text: words.join(' ') };
}

/**
 * Readable problems with a custom section's query; empty when it is fine. Mirrors what GitHub
 * would answer with a 422, plus `is:issue`, which would silently match nothing.
 */
export function validateCustomQuery(query: string): string[] {
  const trimmed = query.trim();
  if (trimmed === '') return ['Enter a GitHub search query, for example: author:@me label:bug'];
  const errors: string[] = [];
  if (NOT_A_PR.test(trimmed)) {
    errors.push('Prowl follows pull requests only: remove is:issue (or type:issue, -is:pr).');
  }
  const { operators, text } = analyze(trimmed);
  if (operators > 0 && text === '') {
    errors.push(
      'AND, OR and NOT only work between search words, not between qualifiers: GitHub rejects ' +
        '"author:a OR author:b". Use one section per qualifier instead.',
    );
  }
  if (operators > MAX_OPERATORS) {
    errors.push(
      `GitHub allows at most ${MAX_OPERATORS} AND / OR / NOT operators in a search (found ${operators}).`,
    );
  }
  if (text.length > MAX_TEXT_LENGTH) {
    errors.push(
      `GitHub limits the search words to ${MAX_TEXT_LENGTH} characters, not counting qualifiers ` +
        `such as author:@me (found ${text.length}).`,
    );
  }
  return errors;
}
