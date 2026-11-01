import type { Section } from '../model';
import { defaultSettings, normalizeSettings } from './settings';

export const presets = (overrides: Partial<Record<string, boolean>> = {}): Section[] => [
  { id: 'authored', kind: 'authored', label: 'Created by me', enabled: overrides.authored ?? true },
  {
    id: 'review_requested',
    kind: 'review_requested',
    label: 'Review requested',
    enabled: overrides.review_requested ?? false,
  },
  {
    id: 'team_review_requested',
    kind: 'team_review_requested',
    label: 'Team reviews',
    enabled: overrides.team_review_requested ?? false,
  },
  { id: 'mentioned', kind: 'mentioned', label: 'Mentioned', enabled: overrides.mentioned ?? false },
  {
    id: 'assigned',
    kind: 'assigned',
    label: 'Assigned to me',
    enabled: overrides.assigned ?? false,
  },
];

export function sectionsOf(sections: unknown): Section[] {
  return normalizeSettings({ ...defaultSettings(), sections }).sections;
}
