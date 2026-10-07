import { describe, expect, it } from 'vitest';
import type { CheckSummary } from '../../lib/model';
import { buildPullRequest } from '../../test/panel';
import { ciStatus, describePullRequest, pullRequestStatuses } from './prStatus';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const checks = (overrides: Partial<CheckSummary>): CheckSummary => ({
  state: 'none',
  total: 0,
  passed: 0,
  failed: 0,
  pending: 0,
  neutral: 0,
  ...overrides,
});

describe('ciStatus', () => {
  it.each([
    [
      checks({ state: 'failure', total: 8, failed: 2, pending: 1, passed: 5 }),
      { tone: 'danger', icon: 'x', label: '2 failing' },
      'Checks failing: 2 failed, 1 pending, 5 passed (8 checks)',
    ],
    [
      checks({ state: 'pending', total: 3, pending: 2, passed: 1 }),
      { tone: 'attention', icon: 'dot', label: '2 pending' },
      'Checks running: 2 pending, 1 passed (3 checks)',
    ],
    [
      checks({ state: 'success', total: 4, passed: 3, neutral: 1 }),
      { tone: 'success', icon: 'check', label: '3 passed' },
      'Checks passed: 3 passed, 1 skipped (4 checks)',
    ],
    [
      checks({ state: 'success', total: 1, neutral: 1 }),
      { tone: 'success', icon: 'check', label: 'Passed' },
      'Checks passed: 1 skipped (1 check)',
    ],
  ])('summarizes %o', (summary, expected, detail) => {
    expect(ciStatus(summary)).toEqual({ id: 'ci', ...expected, detail });
  });

  it('says nothing when there are no checks', () => {
    expect(ciStatus(checks({}))).toBeNull();
  });
});

describe('pullRequestStatuses', () => {
  const labels = (pr: Parameters<typeof pullRequestStatuses>[0]) =>
    pullRequestStatuses(pr).map((status) => status.label);

  it('has no chips for a plain PR that is not ready', () => {
    expect(labels(buildPullRequest({ mergeable: 'unknown' }))).toEqual([]);
  });

  it('lists draft, CI, review and conflicts in reading order', () => {
    const pr = buildPullRequest({
      isDraft: true,
      checks: checks({ state: 'failure', total: 2, failed: 1, passed: 1 }),
      reviewDecision: 'changes_requested',
      mergeable: 'conflicting',
      mergeStateStatus: 'dirty',
    });
    expect(pullRequestStatuses(pr)).toMatchObject([
      { id: 'draft', tone: 'neutral', label: 'Draft' },
      { id: 'ci', tone: 'danger', label: '1 failing' },
      { id: 'review', tone: 'danger', icon: 'diff', label: 'Changes requested' },
      { id: 'merge', tone: 'warning', icon: 'alert', label: 'Conflicts' },
    ]);
  });

  it('asks for a review unless the PR is a draft', () => {
    const pr = buildPullRequest({ reviewDecision: 'review_required' });
    expect(labels(pr)).toEqual(['Review required']);
    expect(labels({ ...pr, isDraft: true })).toEqual(['Draft']);
  });

  it('folds "approved" into "ready to merge", and keeps it when something blocks the merge', () => {
    const passing = checks({ state: 'success', total: 2, passed: 2 });
    const ready = buildPullRequest({
      reviewDecision: 'approved',
      checks: passing,
      mergeStateStatus: 'clean',
    });
    expect(labels(ready)).toEqual(['2 passed', 'Ready to merge']);
    expect(labels({ ...ready, reviewDecision: 'none' })).toEqual(['2 passed', 'Ready to merge']);

    const waiting = {
      ...ready,
      checks: checks({ state: 'pending', total: 2, pending: 1, passed: 1 }),
    };
    expect(labels({ ...waiting, mergeStateStatus: 'blocked' })).toEqual(['1 pending', 'Approved']);
  });

  it('shows conflicts instead of ready to merge', () => {
    const pr = buildPullRequest({ mergeable: 'conflicting', mergeStateStatus: 'clean' });
    expect(labels(pr)).toEqual(['Conflicts']);
  });
});

describe('describePullRequest', () => {
  it('names every fact the card shows', () => {
    const pr = buildPullRequest({
      number: 42,
      title: 'Fix the flaky test',
      author: { login: 'bob', avatarUrl: '', isBot: false },
      checks: checks({ state: 'failure', total: 3, failed: 1, passed: 2 }),
      unresolvedThreads: 2,
      commentCount: 1,
      labels: [
        { name: 'bug', color: 'd73a4a' },
        { name: 'ui', color: 'ffffff' },
      ],
      updatedAt: '2026-10-06T11:55:00.000Z',
      createdAt: '2026-10-03T12:00:00.000Z',
    });
    expect(describePullRequest(pr, pullRequestStatuses(pr), true, NOW)).toBe(
      'acme/widgets#42, by bob. Checks failing: 1 failed, 2 passed (3 checks). ' +
        '2 unresolved threads. 1 comment. Labels: bug, ui. Updated 5 min ago. Opened 3 d ago. Unseen changes',
    );
  });

  it('leaves out what is absent', () => {
    const pr = buildPullRequest({ author: null });
    expect(describePullRequest(pr, [], false, NOW)).toBe(
      'acme/widgets#1. Updated 2 h ago. Opened 5 d ago',
    );
  });
});

describe('auto-merge', () => {
  it('says auto-merge is on, with the method and who turned it on, after conflicts', () => {
    const on = buildPullRequest({ autoMerge: { method: 'squash', enabledBy: 'alice' } });
    expect(pullRequestStatuses(on).find((s) => s.id === 'merge')).toMatchObject({
      label: 'Auto-merge',
      detail: 'Auto-merge on (squash), by alice',
    });
    const conflicting = { ...on, mergeable: 'conflicting' as const };
    expect(pullRequestStatuses(conflicting).find((s) => s.id === 'merge')?.label).toBe('Conflicts');
    const anonymous = buildPullRequest({ autoMerge: { method: 'merge', enabledBy: null } });
    expect(pullRequestStatuses(anonymous).find((s) => s.id === 'merge')?.detail).toBe(
      'Auto-merge on (merge commit)',
    );
  });
});
