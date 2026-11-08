import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { PullRequest } from '../../lib/model';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { auth } from '../state/store';
import { ReviewActions } from './ReviewActions';

const pr = buildPullRequest();
const show = (overrides: Partial<PullRequest> = {}) =>
  render(<ReviewActions pr={{ ...pr, ...overrides }} />);
const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  auth.value = buildAuth('octocat');
});

afterEach(() => {
  auth.value = undefined;
});

it('retains separate drafts across card/view unmounts without mixing pull requests', () => {
  const first = show();
  fireEvent.click(button('Comment on acme/widgets#1'));
  fireEvent.input(screen.getByRole('textbox', { name: /Message/ }), {
    target: { value: 'Keep this draft' },
  });
  first.unmount();
  const other = show(buildPullRequest({ number: 2 }));
  fireEvent.click(button('Comment on acme/widgets#2'));
  expect((screen.getByRole('textbox', { name: /Message/ }) as HTMLTextAreaElement).value).toBe('');
  other.unmount();
  show();
  fireEvent.click(button('Comment on acme/widgets#1'));
  expect((screen.getByRole('textbox', { name: /Message/ }) as HTMLTextAreaElement).value).toBe(
    'Keep this draft',
  );
});

it('clears private draft text when the account changes', () => {
  show();
  fireEvent.click(button('Comment on acme/widgets#1'));
  fireEvent.input(screen.getByRole('textbox', { name: /Message/ }), {
    target: { value: 'Private draft' },
  });
  act(() => {
    auth.value = buildAuth('hubot');
  });
  expect((screen.getByRole('textbox', { name: /Message/ }) as HTMLTextAreaElement).value).toBe('');
});

it('keeps a draft when the same account signs in again with another token', () => {
  show();
  fireEvent.click(button('Comment on acme/widgets#1'));
  fireEvent.input(screen.getByRole('textbox', { name: /Message/ }), {
    target: { value: 'Still mine' },
  });
  act(() => {
    auth.value = { ...buildAuth('octocat'), token: 'ghp_rotated' };
  });
  expect((screen.getByRole('textbox', { name: /Message/ }) as HTMLTextAreaElement).value).toBe(
    'Still mine',
  );
});
