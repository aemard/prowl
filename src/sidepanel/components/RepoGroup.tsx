import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import { ChevronDownIcon, ChevronRightIcon } from './icons';
import { Badge } from './ui/Badge';
import './RepoGroup.css';

export interface RepoGroupProps {
  /** `owner/name`. */
  repo: string;
  /** Pull requests in the group (the cards `children` holds when it is open). */
  count: number;
  expanded: boolean;
  onToggle: () => void;
  /** The group's `PullRequestCard`s. Rendered only while the group is open. */
  children: ComponentChildren;
}

/**
 * One repository of a grouped list: a heading whose button folds the group, and its cards in a
 * list of their own. A folded group renders no cards, so keyboard navigation and the seen
 * observer, which look at the DOM, skip it. The button is named by what it shows, the
 * repository and the count ("acme/web 3 pull requests"), and `aria-controls` points at the list
 * only while it exists.
 */
export function RepoGroup({ repo, count, expanded, onToggle, children }: RepoGroupProps) {
  const listId = useId();
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;
  return (
    <li class="repo-group">
      <h2 class="repo-group__heading">
        <button
          type="button"
          class="repo-group__toggle"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          onClick={onToggle}
        >
          <Chevron />
          <span class="repo-group__name" title={repo}>
            {repo}
          </span>
          <Badge size="sm">
            {count}
            <span class="sr-only"> pull request{count === 1 ? '' : 's'}</span>
          </Badge>
        </button>
      </h2>
      {expanded && (
        <ul id={listId} class="pr-list" aria-label={`${repo} pull requests`}>
          {children}
        </ul>
      )}
    </li>
  );
}
