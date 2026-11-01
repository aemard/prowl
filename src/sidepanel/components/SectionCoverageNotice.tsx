import { env } from '../../lib/env';
import type { SectionCoverage } from '../../lib/model';
import { changePrLimit } from '../state/settings';
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
  const query = coverage.queries.map(({ query }) => query).join(' ');
  return (
    <aside class="list__coverage" aria-label="List coverage">
      <p>
        {count} {count === 1 ? 'PR' : 'PRs'} loaded. More results are available on GitHub.
      </p>
      <p class="list__coverage-help">Only loaded PRs are monitored in this section.</p>
      <div class="list__coverage-actions">
        <Button size="sm" variant="ghost" onClick={changePrLimit}>
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
