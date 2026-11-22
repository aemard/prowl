/**
 * The list's sections as stored: the presets (fixed id, kind and label) and custom searches, and
 * how a stored list is repaired into a valid one.
 */
import type { Section, SectionKind } from '../model';
import { isRecord } from './guards';
import { bool } from './settingsValues';

export const MAX_SECTION_LABEL_LENGTH = 60;

export type BuiltInSectionKind = Exclude<SectionKind, 'custom'>;

/** Preset sections in default order. A preset's id is its kind and its label is fixed. */
const BUILT_IN_SECTIONS: Record<BuiltInSectionKind, { label: string; enabled: boolean }> = {
  authored: { label: 'Created by me', enabled: true },
  review_requested: { label: 'Review requested', enabled: true },
  team_review_requested: { label: 'Team reviews', enabled: false },
  mentioned: { label: 'Mentioned', enabled: false },
  assigned: { label: 'Assigned to me', enabled: false },
  // Last, so installs from before it get it appended in the same place as new ones.
  your_turn: { label: 'Your turn', enabled: true },
};

export const BUILT_IN_SECTION_KINDS = Object.keys(
  BUILT_IN_SECTIONS,
) as readonly BuiltInSectionKind[];

export function builtInSection(
  kind: BuiltInSectionKind,
  enabled = BUILT_IN_SECTIONS[kind].enabled,
) {
  return { id: kind, kind, label: BUILT_IN_SECTIONS[kind].label, enabled } satisfies Section;
}

function isBuiltInKind(value: unknown): value is BuiltInSectionKind {
  return typeof value === 'string' && Object.hasOwn(BUILT_IN_SECTIONS, value);
}

const CUSTOM_ID = /^[A-Za-z0-9_-]{1,64}$/;

function label(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, MAX_SECTION_LABEL_LENGTH);
}

/** A section with its stored id (`''` for a custom section whose id must be regenerated). */
function parseSection(value: unknown): Section | null {
  if (!isRecord(value)) return null;
  if (isBuiltInKind(value.kind)) {
    return builtInSection(value.kind, bool(value.enabled, BUILT_IN_SECTIONS[value.kind].enabled));
  }
  if (value.kind !== 'custom') return null;
  const query = typeof value.query === 'string' ? value.query.trim() : '';
  if (query === '') return null;
  const id = typeof value.id === 'string' && CUSTOM_ID.test(value.id) ? value.id : '';
  return {
    id: isBuiltInKind(id) ? '' : id,
    kind: 'custom',
    label: label(value.label, query),
    enabled: bool(value.enabled, true),
    query,
  };
}

/**
 * Keeps the stored order. Presets appear exactly once (missing ones are appended with their
 * defaults, duplicates dropped); custom sections need a query and get a fresh `custom-N` id
 * when theirs is missing, invalid or already used.
 */
export function normalizeSections(value: unknown): Section[] {
  if (!Array.isArray(value)) return BUILT_IN_SECTION_KINDS.map((kind) => builtInSection(kind));
  const parsed = value.map(parseSection).filter((section) => section !== null);
  const reserved = new Set(parsed.map((section) => section.id));
  const used = new Set<string>();
  const sections: Section[] = [];
  let next = 1;
  for (const section of parsed) {
    if (section.kind !== 'custom' && used.has(section.id)) continue;
    if (section.kind === 'custom' && (section.id === '' || used.has(section.id))) {
      while (reserved.has(`custom-${next}`) || used.has(`custom-${next}`)) next += 1;
      section.id = `custom-${next}`;
    }
    used.add(section.id);
    sections.push(section);
  }
  for (const kind of BUILT_IN_SECTION_KINDS) {
    if (used.has(kind)) continue;
    // "Review requested" used to include team requests: whoever followed it keeps seeing them.
    const inherited =
      kind === 'team_review_requested'
        ? parsed.find((section) => section.id === 'review_requested')?.enabled
        : undefined;
    sections.push(builtInSection(kind, inherited));
  }
  return sections;
}
