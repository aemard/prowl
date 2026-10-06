import type { ComponentChildren } from 'preact';
import { cx } from './cx';
import './EmptyState.css';

export interface EmptyStateProps {
  /** Short, sentence case: "No pull requests". */
  title: string;
  /** One or two sentences on why it is empty and what to do. */
  description?: ComponentChildren;
  /** Decorative icon (24 px). */
  icon?: ComponentChildren;
  /** Usually one Button. */
  action?: ComponentChildren;
  /** Heading level that fits the surrounding outline (default 2). */
  headingLevel?: 2 | 3;
  class?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  headingLevel = 2,
  class: className,
}: EmptyStateProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <div class={cx('ui-empty', className)}>
      {icon && (
        <div class="ui-empty__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <Heading class="ui-empty__title">{title}</Heading>
      {description && <p class="ui-empty__description">{description}</p>}
      {action && <div class="ui-empty__action">{action}</div>}
    </div>
  );
}
