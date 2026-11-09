import { env } from '../../lib/env';
import { t } from '../../lib/i18n';
import type { SectionCoverage } from '../../lib/model';
import { GitHubLink } from './GitHubLink';

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
  const query = coverage.queries.find(({ cursor }) => cursor)?.query ?? coverage.queries[0]?.query;
  return (
    <aside class="list__coverage" aria-label={t('listCoverage')}>
      <span>{t('loadedCount', count)}</span>
      {query && (
        <GitHubLink href={`${env.webUrl}/pulls?q=${encodeURIComponent(query)}`}>
          {t('viewOnGitHub')}
        </GitHubLink>
      )}
    </aside>
  );
}
