import { t } from '../../lib/i18n';
import type { CheckItemState, PullRequestDetail } from '../../lib/model';
import { isGitHubUrl } from '../../lib/url';
import { GitHubLink } from './GitHubLink';
import { CheckIcon, DotFillIcon, XIcon } from './icons';
import { Badge } from './ui/Badge';
import type { Tone } from './ui/cx';
import './Deployments.css';

const LOOK: Partial<Record<CheckItemState, { tone: Tone; Icon: typeof CheckIcon; label: string }>> =
  {
    passed: { tone: 'success', Icon: CheckIcon, label: t('deployed') },
    pending: { tone: 'attention', Icon: DotFillIcon, label: t('deploying') },
    failed: { tone: 'danger', Icon: XIcon, label: t('deployFailed') },
  };

/**
 * Where the head commit is deployed (preview, staging...). A deployment URL off GitHub is shown
 * as text: the panel only opens GitHub pages.
 */
export function Deployments({
  deployments,
  id,
}: {
  deployments: NonNullable<PullRequestDetail['deployments']>;
  id: string;
}) {
  return (
    <div class="pr-detail__group">
      <p class="pr-detail__label" id={id}>
        {t('deployments')}
      </p>
      <ul class="deployments" aria-labelledby={id}>
        {deployments.map(({ environment, state, url }) => {
          const look = LOOK[state];
          return (
            <li key={environment} class="deployments__item">
              <span class="deployments__name">{environment}</span>
              {look && (
                <Badge tone={look.tone} variant="plain" icon={<look.Icon size={12} />}>
                  {look.label}
                </Badge>
              )}
              {url &&
                (isGitHubUrl(url) ? (
                  <GitHubLink href={url}>{new URL(url).host}</GitHubLink>
                ) : (
                  <span class="deployments__url">{url}</span>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
