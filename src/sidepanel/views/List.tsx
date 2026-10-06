import { InboxIcon } from '../components/icons';
import { EmptyState } from '../components/ui/EmptyState';

/** The pull request list. US-013 replaces this placeholder. */
export function ListView() {
  return (
    <EmptyState
      icon={<InboxIcon size={24} />}
      title="No pull requests yet"
      description="Pull requests you follow will appear here."
    />
  );
}
