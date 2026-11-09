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
import { isNode, sameSearchFacts } from './fetchMergeState';
import type { FetchResult, FetchSettings } from './fetchPullRequests';
import { type MergeFacts, mapMergeState, mapPullRequest } from './mapPullRequest';
import { SEARCH_QUERY, type SearchData, TEAM_SEARCH_QUERY } from './queries';
import { parseRateLimit } from './rateLimit';
import { buildSearchQuery, filterByRepo } from './search';
import { teamEvidence } from './teamEvidence';

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

const mergeFacts = (pr: PullRequest): MergeFacts => ({
  reviewDecision: pr.reviewDecision,
  mergeable: pr.mergeable,
  mergeStateStatus: pr.mergeStateStatus,
  viewerCanUpdate: pr.viewerCanUpdate,
  viewerCanMergeAsAdmin: pr.viewerCanMergeAsAdmin === true,
  viewerCanEnableAutoMerge: pr.viewerCanEnableAutoMerge === true,
  viewerCanDisableAutoMerge: pr.viewerCanDisableAutoMerge === true,
});

export type PreviousSnapshot = Pick<Snapshot, 'pullRequests' | 'mergeStateAt'> &
  Partial<Pick<Snapshot, 'sections' | 'sectionCoverage' | 'teamRequests'>>;

type SearchResult = { prs: PullRequest[]; coverage: SectionCoverage; problems: string[] };

export class SearchContext {
  constructor(
    readonly client: GitHubClient,
    readonly settings: FetchSettings,
    readonly previous: PreviousSnapshot | null,
    readonly teams: Pick<TeamsState, 'teams' | 'error' | 'incomplete'> | null,
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

  async search(query: string, teamSearch = false): Promise<SearchResult> {
    const found = new Map<string, PullRequest>();
    const problems: string[] = [];
    let after: string | null = null;
    let hasMore = false;
    let cut = false;
    let total: number | undefined;
    let examined = 0;
    let pages = 0;
    // Bound both examined nodes and requests when repository filters reject whole pages.
    const scanBudget = Math.min(500, Math.max(100, this.settings.maxPerSection * 5));
    do {
      pages++;
      const first = Math.min(
        PAGE_SIZE,
        this.settings.maxPerSection - found.size,
        scanBudget - examined,
      );
      try {
        const { search: page } = await this.searchPage({ query, first, after }, teamSearch);
        this.searched = true;
        examined += first;
        total = page.issueCount;
        for (const pr of this.pagePrs(page, teamSearch)) found.set(pr.id, pr);
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
    } while (
      hasMore &&
      found.size < this.settings.maxPerSection &&
      examined < scanBudget &&
      pages < 20
    );
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

  private async searchPage(
    variables: Record<string, unknown>,
    teams: boolean,
  ): Promise<SearchData> {
    try {
      const data = await this.read<SearchData>(
        teams && !this.teamFallback ? TEAM_SEARCH_QUERY : SEARCH_QUERY,
        variables,
      );
      if (teams && !data.search && this.partialMessages.length) {
        this.teamFallback = true;
        return this.read<SearchData>(SEARCH_QUERY, variables);
      }
      return data;
    } catch (error) {
      if (
        !teams ||
        this.teamFallback ||
        !(error instanceof GitHubError) ||
        !['forbidden', 'graphql'].includes(error.kind)
      )
        throw error;
      this.teamFallback = true;
      return this.read<SearchData>(SEARCH_QUERY, variables);
    }
  }

  private teamFallback = false;
  readonly excludedPrs = new Set<string>();
  private pagePrs(page: SearchData['search'], teamSearch: boolean): PullRequest[] {
    const nodes = (page.nodes ?? []).filter(isNode).filter((node) => {
      if (!teamSearch) return true;
      const evidence = teamEvidence(
        node,
        this.teams,
        this.settings.unfollowedTeams,
        !this.teamFallback && this.partialMessages.length === 0,
      );
      if (evidence.drop) this.excludedPrs.add(node.id);
      else if (evidence.keys.length) this.result.teamRequests[node.id] = evidence.keys;
      return !evidence.drop;
    });
    return filterByRepo(nodes.map(mapPullRequest), this.settings);
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
      ? { ...pr, ...(sameSearchFacts(before, pr) ? mergeFacts(before) : mapMergeState({})) }
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
      if (section.kind === 'team_review_requested' && this.excludedPrs.has(pr.id)) continue;
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

  /** One search even without team discovery; exclusions require complete evidence. */
  async searchTeams(section: Section): Promise<void> {
    const query = `${buildSearchQuery(section, this.settings)} sort:updated-desc`;
    try {
      const page = await this.search(query, true);
      for (const pr of page.prs) this.put(pr);
      this.result.sections[section.id] = page.prs.map(({ id }) => id);
      if (page.problems.length)
        this.result.sectionErrors[section.id] = this.problemText(page.problems);
      if (page.coverage.stale) this.preserve(section);
      this.coverageFor(section.id, page.coverage);
    } catch (error) {
      if (!this.sectionLevel(error)) throw error;
      this.result.sectionErrors[section.id] = error.message;
      this.preserve(section);
      this.coverageFor(section.id, {
        hasMore: false,
        partial: true,
        stale: true,
        queries: [{ query, cursor: null }],
      });
    }
  }

  partialErrors = () => this.partialMessages;
  checkSearches() {
    if (!this.searched && this.serverError) throw this.serverError;
  }
}
