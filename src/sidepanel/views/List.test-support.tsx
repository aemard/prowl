import { act, screen } from '@testing-library/preact';
import { afterEach, beforeEach, vi } from 'vitest';
import type { PullRequest, Settings } from '../../lib/model';
import { defaultSettings } from '../../lib/storage/settings';
import { buildPullRequest } from '../../test/panel';
import { details, expandedIds } from '../state/prDetail';
import { auth, pollState, prLocal, settings, snapshot } from '../state/store';
import { activeSectionId, filterQuery, foldedGroups, showHidden } from './List';

export const NOW = Date.parse('2026-10-06T12:00:00.000Z');

class FakeObserver {
  static all: FakeObserver[] = [];
  targets: Element[] = [];
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeObserver.all.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  disconnect() {
    FakeObserver.all = FakeObserver.all.filter((observer) => observer !== this);
  }
  show(ids: string[]) {
    const entries = this.targets.map((target) => ({
      target,
      isIntersecting: ids.includes((target as HTMLElement).dataset.prId ?? ''),
    }));
    act(() => this.callback(entries as IntersectionObserverEntry[], this as never));
  }
}

export const observer = () => FakeObserver.all.at(-1) as FakeObserver;

export function withSections(kinds: string[], overrides: Partial<Settings> = {}) {
  const base = defaultSettings();
  settings.value = {
    ...base,
    ...overrides,
    sections: base.sections.map((section) => ({ ...section, enabled: kinds.includes(section.id) })),
  };
}

export const repo = (nameWithOwner: string) => {
  const [owner = '', name = ''] = nameWithOwner.split('/');
  return { owner, name, nameWithOwner };
};

export const pr = (number: number, overrides: Partial<PullRequest> = {}) =>
  buildPullRequest({ number, title: `PR number ${number}`, ...overrides });

export const titles = () => screen.queryAllByRole('link').map((link) => link.textContent);

export const cardTitles = () =>
  [...document.querySelectorAll('.pr-card__title')].map((title) => title.textContent);

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  settings.value = defaultSettings();
});

afterEach(() => {
  vi.useRealTimers();
  FakeObserver.all = [];
  settings.value = defaultSettings();
  snapshot.value = undefined;
  pollState.value = undefined;
  prLocal.value = { snoozed: {}, muted: {}, seen: {} };
  activeSectionId.value = undefined;
  filterQuery.value = '';
  showHidden.value = false;
  foldedGroups.value = [];
  location.hash = '';
  auth.value = undefined;
  expandedIds.value = [];
  details.value = {};
  Reflect.deleteProperty(document, 'visibilityState');
});
