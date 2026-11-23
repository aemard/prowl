/** A thread of `GET /notifications` as GitHub answers it (the fields Prowl reads). */
export function notificationThread({
  type = 'PullRequest',
  updatedAt,
  reason = 'review_requested',
  repo = 'acme/widgets',
}: {
  type?: string;
  updatedAt: string;
  reason?: string;
  repo?: string;
}) {
  return {
    reason,
    subject: { type },
    repository: { full_name: repo },
    updated_at: updatedAt,
  };
}
