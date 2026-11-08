import { computed, effect, signal } from '@preact/signals';
import { auth } from './store';

export type ReviewDraftKind = 'request_changes' | 'comment';

/** In-memory drafts outlive card/view mounts, and never leave the current panel session. */
export const reviewDrafts = signal<Record<string, Partial<Record<ReviewDraftKind, string>>>>({});

const account = computed(() => auth.value?.viewer.login.toLowerCase());
effect(() => {
  void account.value;
  reviewDrafts.value = {};
});

export function setReviewDraft(id: string, kind: ReviewDraftKind, text: string): void {
  reviewDrafts.value = {
    ...reviewDrafts.value,
    [id]: { ...reviewDrafts.value[id], [kind]: text },
  };
}
