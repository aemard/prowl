/** A `PrEvent` as the diff engine emits it, for notification tests. */
import type { PrEvent } from '../../src/lib/model';

export function prEvent(overrides: Partial<PrEvent> = {}): PrEvent {
  const type = overrides.type ?? 'ci_failed';
  const number = overrides.number ?? 1;
  const prId = overrides.prId ?? `PR_acme_widgets_${number}`;
  return {
    id: `${prId}:${type}:key`,
    type,
    prId,
    repo: 'acme/widgets',
    number,
    title: `Improve widget ${number}`,
    url: `https://github.com/acme/widgets/pull/${number}`,
    actor: null,
    at: '2026-10-06T12:00:00.000Z',
    ...overrides,
  };
}
