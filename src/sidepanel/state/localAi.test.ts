import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../../tests/fixtures/http';
import { textNode } from '../../../tests/fixtures/text';
import { buildAuth, buildDetail, buildPullRequest } from '../../test/panel';
import { aiAnswers, aiState, answerOf, runAi } from './localAi';
import { auth } from './store';

const g = globalThis as Record<string, unknown>;
const failing = {
  state: 'failure',
  total: 2,
  passed: 1,
  failed: 1,
  pending: 0,
  neutral: 0,
} as const;

describe('answerOf', () => {
  const pr = buildPullRequest({ checks: failing });
  const run = (url: string) =>
    buildDetail({ checks: [{ name: 'test', state: 'failed', url, required: true }] });
  const first = run('https://github.com/a/b/runs/1');
  afterEach(() => {
    aiAnswers.value = {};
  });

  it('keeps an explanation to the failing check runs, so a re-run with the same count asks again', () => {
    aiAnswers.value = {
      [`${pr.id}:failure`]: {
        loading: false,
        text: 'A test fails.',
        for: { version: `${pr.headSha}:1`, runs: 'https://github.com/a/b/runs/1' },
      },
    };
    expect(answerOf(pr, 'failure', first)?.text).toBe('A test fails.');
    expect(answerOf(pr, 'failure', run('https://github.com/a/b/runs/2'))).toBeUndefined();
    expect(answerOf({ ...pr, headSha: 'c'.repeat(40) }, 'failure', first)).toBeUndefined();
    // While the detail reloads, the head and the count are all there is to compare.
    expect(answerOf(pr, 'failure')?.text).toBe('A test fails.');
  });

  it('shows an answer asked before the detail loaded once it has', () => {
    aiAnswers.value = {
      [`${pr.id}:failure`]: {
        loading: false,
        text: 'A test fails.',
        for: { version: `${pr.headSha}:1` },
      },
    };
    expect(answerOf(pr, 'failure', first)?.text).toBe('A test fails.');
  });
});

describe('runAi across accounts', () => {
  let signal: AbortSignal | undefined;
  beforeEach(() => {
    auth.value = buildAuth();
    aiState.value = {
      availability: 'available',
      models: { summarizer: 'unavailable', prompt: 'available' },
    };
    g.LanguageModel = {
      availability: async () => 'available',
      create: async (options: { signal?: AbortSignal }) => {
        signal = options.signal;
        return { prompt: async () => 'Answer for the first account.', destroy: () => {} };
      },
    };
  });
  afterEach(() => {
    delete g.LanguageModel;
    aiState.value = {};
    aiAnswers.value = {};
    auth.value = undefined;
    vi.unstubAllGlobals();
  });

  it('drops and aborts an answer when another account signs in meanwhile', async () => {
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    const pr = buildPullRequest();
    const running = runAi(pr, 'summary');
    expect(aiAnswers.value[`${pr.id}:summary`]).toMatchObject({ loading: true });
    auth.value = { ...buildAuth(), token: 'ghp_other' };
    expect(aiAnswers.value).toEqual({});
    expect(signal?.aborted).toBe(true);
    answer(jsonResponse({ data: { node: textNode({}) } }));
    await running;
    expect(aiAnswers.value).toEqual({});
  });
});
