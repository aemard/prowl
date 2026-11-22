import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import { failingRunText, textNode } from '../../../tests/fixtures/text';
import { buildAuth, buildPullRequest } from '../../test/panel';
import { aiAnswers, aiState } from '../state/localAi';
import { auth } from '../state/store';
import { LocalAi } from './LocalAi';

const g = globalThis as Record<string, unknown>;
const failing = {
  state: 'failure',
  total: 1,
  passed: 0,
  failed: 1,
  pending: 0,
  neutral: 0,
} as const;

function chromeAi(answer: (input: string) => string) {
  const prompt = vi.fn(async (input: string) => answer(input));
  g.LanguageModel = {
    availability: async () => 'available',
    create: async () => ({ prompt, destroy: () => {} }),
  };
  return prompt;
}

describe('LocalAi', () => {
  beforeEach(() => {
    auth.value = buildAuth();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: { node: textNode({}, [failingRunText()]) } })),
    );
  });
  afterEach(() => {
    delete g.LanguageModel;
    aiState.value = {};
    aiAnswers.value = {};
    auth.value = undefined;
    vi.unstubAllGlobals();
  });

  it('renders nothing where Chrome has no on-device model', async () => {
    const { container } = render(<LocalAi pr={buildPullRequest()} />);
    await waitFor(() => expect(aiState.value.availability).toBe('unavailable'));
    expect(container.innerHTML).toBe('');
  });

  it('summarizes the pull request as plain text, with a note that it can be wrong', async () => {
    chromeAi(() => '<b>Adds a faster widget.</b>');
    render(<LocalAi pr={buildPullRequest()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Summarize' }));
    const answer = await screen.findByRole('region', { name: 'Summary' });
    expect(answer.textContent).toContain('<b>Adds a faster widget.</b>');
    expect(answer.querySelector('b')).toBeNull();
    expect(answer.textContent).toContain('It can be wrong.');
    expect(screen.queryByRole('button', { name: 'Explain the failure' })).toBeNull();
  });

  it('explains failing checks from their reports, and says when the model fails', async () => {
    const prompt = chromeAi(() => 'The widget test expects 2.');
    render(<LocalAi pr={buildPullRequest({ checks: failing })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Explain the failure' }));
    expect(
      (await screen.findByRole('region', { name: 'Why the checks fail' })).textContent,
    ).toContain('expects 2');
    expect(prompt.mock.calls[0]?.[0]).toContain('src/widget.ts:12');

    prompt.mockRejectedValueOnce(new Error('out of memory'));
    await act(async () => {
      aiAnswers.value = {};
    });
    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The on-device AI could not answer: out of memory',
    );
  });

  it('says in its own words when the text is too long for the model', async () => {
    const prompt = chromeAi(() => '');
    prompt.mockRejectedValueOnce(new DOMException('Input too large', 'QuotaExceededError'));
    render(<LocalAi pr={buildPullRequest()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Summarize' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This pull request is too long for the on-device AI, even shortened.',
    );
  });

  it('offers to ask again, and hides a summary once the pull request has new activity', async () => {
    const prompt = chromeAi(() => 'First take.');
    const pr = buildPullRequest();
    const view = render(<LocalAi pr={pr} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Summarize' }));
    await screen.findByRole('region', { name: 'Summary' });
    prompt.mockResolvedValueOnce('Second take.');
    fireEvent.click(screen.getByRole('button', { name: 'Summarize again' }));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Summary' }).textContent).toContain('Second'),
    );
    // A new comment without a push: the summary no longer describes the pull request.
    view.rerender(<LocalAi pr={{ ...pr, updatedAt: '2026-11-22T10:00:00Z' }} />);
    expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Summarize' })).toBeTruthy();
  });
});
