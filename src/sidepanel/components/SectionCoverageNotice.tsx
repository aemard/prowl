import { env } from '../../lib/env';
import type { SectionCoverage } from '../../lib/model';
import { navigate } from '../state/router';
import { GitHubLink } from './GitHubLink';
import { Button } from './ui/Button';

/** A proven limit, not a guess based on the number of cards currently visible. */
export function SectionCoverageNotice({
  coverage,
  count,
}: {
  coverage: SectionCoverage;
  count: number;
}) {
  if (!coverage.hasMore) return null;
  // One link, one search: joined queries would only match PRs that satisfy all of them.
  const query = coverage.queries.find(({ cursor }) => cursor)?.query;
  return (
    <aside class="list__coverage" aria-label="List coverage">
      <p>
        {count} {count === 1 ? 'PR' : 'PRs'} loaded. More results are available on GitHub.
      </p>
      <p class="list__coverage-help">Only loaded PRs are monitored in this section.</p>
      <div class="list__coverage-actions">
        <Button size="sm" variant="ghost" onClick={() => navigate('settings')}>
          Change limit
        </Button>
        {query && (
          <GitHubLink href={`${env.webUrl}/pulls?q=${encodeURIComponent(query)}`}>
            View on GitHub
          </GitHubLink>
        )}
      </div>
    </aside>
  );
}
