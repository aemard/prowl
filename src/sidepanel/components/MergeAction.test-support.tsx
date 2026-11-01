import { fireEvent, render, screen, within } from '@testing-library/preact';
import { vi } from 'vitest';
import type { PullRequest } from '../../lib/model';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { pendingActions } from '../state/prActions';
import { auth } from '../state/store';
import { MergeAction } from './MergeAction';
import { toasts } from './ui/Toast';

export const pr = buildPullRequest({ title: 'Improve the widgets', baseRefName: 'release' });
export const merged = { mergePullRequest: { pullRequest: { merged: true } } };

interface Sent {
  operation: string;
  variables: Record<string, unknown>;
}

/** Stubs `fetch`: `answer(sent)` for each GraphQL request, which is recorded in `sent`. */
export function stubGitHub(answer: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const { query, variables } = JSON.parse(String(init.body));
      const request = { operation: /mutation (\w+)/.exec(query)?.[1] ?? '', variables };
      sent.push(request);
      return answer(request);
    }),
  );
  return sent;
}

export const show = (overrides: Partial<PullRequest> = {}) =>
  render(<MergeAction pr={{ ...pr, ...overrides }} />);
export const opener = () => screen.getByRole('button', { name: 'Merge acme/widgets#1' });
export const dialog = () => screen.getByRole('dialog', { name: 'Merge pull request' });
export const method = () => within(dialog()).getByRole('combobox', { name: 'Merge method' });
export const commitTitle = () => within(dialog()).getByRole('textbox', { name: /Commit title/ });
export const confirm = () => within(dialog()).getByRole('button', { name: 'Merge' });
export const choose = (value: string) => fireEvent.change(method(), { target: { value } });
export const toastTexts = () => toasts.value.map(({ message, tone }) => `${tone}: ${message}`);
export const poll = { type: 'poll', force: true };

export function setupMergeTest() {
  auth.value = buildAuth('octocat');
}

export function resetMergeTest() {
  auth.value = undefined;
  pendingActions.value = {};
  toasts.value = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}
