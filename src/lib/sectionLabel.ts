import { type MessageKey, t } from './i18n';
import type { Section } from './model';

const LABELS: Record<Exclude<Section['kind'], 'custom'>, MessageKey> = {
  authored: 'createdByMe',
  review_requested: 'reviewRequestedSection',
  team_review_requested: 'teamReviews',
  mentioned: 'mentionedSection',
  assigned: 'assignedToMe',
};

/** Stored identifiers and user-written names are independent of the browser's language. */
export function sectionLabel(section: Section): string {
  return section.kind === 'custom' ? section.label : t(LABELS[section.kind]);
}
