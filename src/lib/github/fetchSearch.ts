/** Bounded section searches, coverage metadata and cached membership after cut scans. */
import type {
  ErrorKind,
  PullRequest,
  Section,
  SectionCoverage,
  Snapshot,
  TeamsState,
} from '../model';
import type { GitHubClient } from './client';
import { GitHubError } from './errors';
import { isNode } from './fetchMergeState';
import type { FetchResult, FetchSettings } from './fetchPullRequests';
import { type MergeFacts, mapMergeState, mapPullRequest } from './mapPullRequest';
import { SEARCH_QUERY, type SearchData } from './queries';
import { parseRateLimit } from './rateLimit';
import { buildSearchQuery, filterByRepo } from './search';
import { MAX_TEAM_SEARCHES, teamKey } from './teams';

const NO_TEAM =
  'GitHub lists no team for your account. An organization that requires single sign-on, or ' +
  'restricts OAuth apps, lists its teams only once it has approved your token or Prowl.';
const NO_FOLLOWED_TEAM = 'You follow none of your teams. Follow one in Settings.';
/** A search came back with holes where an organization's SAML enforcement refused the token. */
const SSO_REQUIRED =
  'An organization requires single sign-on (SAML) that this token is not authorized for, so ' +
  'its pull requests are missing. Authorize the token for that organization on GitHub.';
const SAML = /\bSAML\b/i;

/** Search page size: about 4 s on busy organizations, inside GitHub's 10 s execution limit. */
const PAGE_SIZE = 25;
/**
 * Failures about the token, the budget or the connection: the whole poll must back off. A
 * `server` error is usually one heavy search past GitHub's time limit, so it fails that search
 * alone, unless every search failed (`fetchPullRequests`).
 */
const POLL_LEVEL: readonly ErrorKind[] = ['unauthorized', 'rate_limited', 'network'];

const mergeFacts = ({
  reviewDecision,
  mergeable,
  mergeStateStatus,
  viewerCanUpdate,
}: PullRequest): MergeFacts => ({ reviewDecision, mergeable, mergeStateStatus, viewerCanUpdate });

export type PreviousSnapshot = Pick<Snapshot, 'pullRequests' | 'mergeStateAt'> &
  Partial<Pick<Snapshot, 'sections' | 'sectionCoverage'>>;

type SearchResult = { prs: PullRequest[]; coverage: SectionCoverage; problems: string[] };

export class SearchContext {
  constructor(
    readonly client: GitHubClient,
    readonly settings: FetchSettings,
    readonly previous: PreviousSnapshot | null,
    readonly teams: Pick<TeamsState, 'teams' | 'error'> | null,
    readonly result: FetchResult,
  ) {}
  private searched = false;
  private serverError: GitHubError | undefined;

  private partialMessages: string[] = [];
  async read<T extends { rateLimit: unknown }>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    this.partialMessages = [];
    const data = await this.client.graphql<T>(query, variables, {
      partial: true,
      onPartialErrors: (messages) => {
        this.partialMessages = messages;
      },
    });
    this.result.rateLimit = parseRateLimit(data.rateLimit) ?? this.result.rateLimit;
    return data;
  }

  async search(query: string): Promise<SearchResult> {
    const found = new Map<string, PullRequest>();
    const problems: string[] = [];
    let after: string | null = null;
    let hasMore = false;
    let cut = false;
    let total: number | undefined;
    let examined = 0;
    // Local repo intersections may reject whole pages. Bound scanned work independently of
    // retained results: at most 500 nodes per query and never more than 5x the requested cap.
    const scanBudget = Math.min(500, Math.max(100, this.settings.maxPerSection * 5));
    do {
      const first = Math.min(
        PAGE_SIZE,
        this.settings.maxPerSection - found.size,
        scanBudget - examined,
      );
      try {
        const data: SearchData = await this.read<SearchData>(SEARCH_QUERY, { query, first, after });
        const page: SearchData['search'] = data.search;
        this.searched = true;
        examined += first;
        total = page.issueCount;
        for (const pr of filterByRepo(
          (page.nodes ?? []).filter(isNode).map(mapPullRequest),
          this.settings,
        )) {
          found.set(pr.id, pr);
        }
        hasMore = page.pageInfo.hasNextPage;
        if (this.partialMessages.length) problems.push(...this.partialMessages);
        const cursor: string | null = page.pageInfo.endCursor;
        if (!hasMore) break;
        if (!cursor || cursor === after) {
          problems.push('GitHub did not provide a usable next-page cursor.');
          cut = true;
          break;
        }
        after = cursor;
      } catch (error) {
        if (!this.sectionLevel(error)) throw error;
        if (examined === 0) throw error;
        problems.push(error.message);
        cut = true;
        break;
      }
    } while (hasMore && found.size < this.settings.maxPerSection && examined < scanBudget);
    return {
      prs: [...found.values()],
      coverage: {
        hasMore,
        queries: [{ query, cursor: hasMore ? after : null, total }],
        ...(problems.length ? { partial: true } : {}),
        ...(cut ? { stale: true } : {}),
      },
      problems,
    };
  }

  coverageFor = (id: string, coverage: SectionCoverage) => {
    if (coverage.hasMore || coverage.partial || coverage.stale) {
      this.result.sectionCoverage ??= {};
      this.result.sectionCoverage[id] = coverage;
    }
  };
  put = (pr: PullRequest) => {
    const before = this.previous?.pullRequests[pr.id];
    this.result.pullRequests[pr.id] = before
      ? { ...pr, ...(before.headSha === pr.headSha ? mergeFacts(before) : mapMergeState({})) }
      : pr;
  };
  /**
   * A search cut short (or refused) cannot tell which PRs left the section: keeps the cached
   * members up to `maxPerSection`, never over a copy this poll loaded.
   */
  preserve = (section: Section) => {
    const members = new Set(this.result.sections[section.id]);
    const cached = (this.previous?.sections?.[section.id] ?? []).flatMap(
      (id) => this.previous?.pullRequests[id] ?? [],
    );
    for (const pr of filterByRepo(cached, this.settings)) {
      if (members.size >= this.settings.maxPerSection) break;
      members.add(pr.id);
      this.result.pullRequests[pr.id] ??= pr;
    }
    if (members.size) this.result.sections[section.id] = [...members];
  };
  problemText = (problems: string[]) =>
    [...new Set(problems.map((message) => (SAML.test(message) ? SSO_REQUIRED : message)))]
      .slice(0, 5)
      .join(' ');

  /** A refusal or a timeout that only concerns this search; anything else fails the poll. */
  sectionLevel(error: unknown): error is GitHubError {
    if (!(error instanceof GitHubError) || POLL_LEVEL.includes(error.kind)) return false;
    if (error.kind === 'server') this.serverError ??= error;
    return true;
  }

  /**
   * One search per followed team (the first `MAX_TEAM_SEARCHES`), merged newest first and cut
   * to `maxPerSection`. A refused team search is reported; the other teams still load.
   */
  async searchTeams(section: Section): Promise<void> {
    const all = this.teams?.teams ?? [];
    const followed = all.filter((team) => !this.settings.unfollowedTeams.includes(teamKey(team)));
    if (followed.length === 0) {
      this.result.sectionErrors[section.id] =
        all.length > 0 ? NO_FOLLOWED_TEAM : (this.teams?.error?.message ?? NO_TEAM);
      return;
    }
    const problems: string[] = [];
    const queries: SectionCoverage['queries'] = [];
    let hasMore = false;
    let stale = false;
    const found = new Map<string, { pr: PullRequest; keys: string[] }>();
    for (const team of followed.slice(0, MAX_TEAM_SEARCHES)) {
      const key = teamKey(team);
      try {
        const query = buildSearchQuery(section, this.settings, key);
        const page = await this.search(`${query} sort:updated-desc`);
        queries.push(...page.coverage.queries);
        hasMore ||= page.coverage.hasMore;
        stale ||= page.coverage.stale === true;
        problems.push(...page.problems);
        for (const pr of page.prs) {
          const entry = found.get(pr.id) ?? { pr, keys: [] };
          entry.keys.push(key);
          found.set(pr.id, entry);
        }
      } catch (error) {
        if (!this.sectionLevel(error)) throw error;
        problems.push(`GitHub refused the search for ${key}: ${error.message}`);
        stale = true;
      }
    }
    if (followed.length > MAX_TEAM_SEARCHES) {
      problems.push(
        `Partial results: ${MAX_TEAM_SEARCHES} of ${followed.length} followed teams searched. Choose teams in Settings.`,
      );
    }
    hasMore ||= found.size > this.settings.maxPerSection;
    const kept = [...found.values()]
      .sort((a, b) => Date.parse(b.pr.updatedAt) - Date.parse(a.pr.updatedAt))
      .slice(0, this.settings.maxPerSection);
    for (const { pr, keys } of kept) {
      this.put(pr);
      this.result.teamRequests[pr.id] = keys;
    }
    this.result.sections[section.id] = kept.map(({ pr }) => pr.id);
    if (problems.length > 0) this.result.sectionErrors[section.id] = this.problemText(problems);
    if (stale) this.preserve(section);
    this.coverageFor(section.id, {
      hasMore,
      queries,
      ...(problems.length ? { partial: true } : {}),
      ...(stale ? { stale: true } : {}),
    });
  }

  partialErrors = () => this.partialMessages;
  checkSearches() {
    if (!this.searched && this.serverError) throw this.serverError;
  }
}
