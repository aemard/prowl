import type { AnchorHTMLAttributes } from 'preact';
import { isGitHubUrl } from '../../lib/url';
import { openGitHubUrl } from '../openUrl';

type GitHubLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target'> & {
  href: string;
};

/**
 * A link to GitHub that opens in a new tab through `openGitHubUrl`. Only URLs on the GitHub web
 * origin get an `href`; any other (a third-party CI, say) renders as inert text.
 */
export function GitHubLink({ href, ...rest }: GitHubLinkProps) {
  return (
    <a
      {...rest}
      href={isGitHubUrl(href) ? href : undefined}
      onClick={(event) => {
        event.preventDefault();
        void openGitHubUrl(href);
      }}
    />
  );
}
