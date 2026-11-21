/**
 * The on-device AI as the panel sees it: whether Chrome can run it here, the download's progress,
 * and the answers already given per pull request (kept until the panel closes, never stored).
 */
import { signal } from '@preact/signals';
import {
  type AiAvailability,
  aiAvailability,
  ask,
  downloadModel,
  summarize,
} from '../../lib/ai/builtInAi';
import { env } from '../../lib/env';
import { createGitHubClient } from '../../lib/github/client';
import { GitHubError } from '../../lib/github/errors';
import { fetchPullRequestText } from '../../lib/github/fetchPullRequestText';
import { t, uiLocale } from '../../lib/i18n';
import type { PullRequest } from '../../lib/model';
import { auth } from './store';

/** Unknown until first checked; `progress` (0-1) while this panel downloads the model. */
export const aiState = signal<{ availability?: AiAvailability; progress?: number }>({});

export async function checkAi(): Promise<void> {
  aiState.value = { ...aiState.value, availability: await aiAvailability(uiLocale()) };
}

/** Starts the one-time model download (from a click) and follows it to the end. */
export async function downloadAi(): Promise<void> {
  aiState.value = { availability: 'downloading', progress: 0 };
  try {
    await downloadModel(uiLocale(), (progress) => {
      aiState.value = { availability: 'downloading', progress };
    });
  } catch {
    // Refused (no gesture, no disk space): the next check says what Chrome thinks now.
  }
  aiState.value = {};
  await checkAi();
}

export type AiTask = 'summary' | 'failure';
export interface AiAnswer {
  loading: boolean;
  text?: string;
  error?: string;
}
/** `<pr id>:<task>:<head sha>` -> answer; a new push asks again. */
export const aiAnswers = signal<Record<string, AiAnswer>>({});
export const answerKey = (pr: PullRequest, task: AiTask) => `${pr.id}:${task}:${pr.headSha}`;

const FAILURE_INSTRUCTION =
  'From these reports of failing CI checks, explain in at most four short sentences what failed and the most likely fix. Name files and lines when the reports give them.';

/** Reads the PR's text from GitHub, then asks the on-device model; one request per key. */
export async function runAi(pr: PullRequest, task: AiTask): Promise<void> {
  const key = answerKey(pr, task);
  const token = auth.value?.token;
  if (!token || aiAnswers.value[key]?.loading) return;
  const put = (answer: AiAnswer) => {
    aiAnswers.value = { ...aiAnswers.value, [key]: answer };
  };
  put({ loading: true });
  try {
    const text = await fetchPullRequestText(
      createGitHubClient({ token, apiUrl: env.apiUrl }),
      pr.id,
    );
    const language = uiLocale();
    if (task === 'failure' && !text.failures)
      return put({ loading: false, text: t('aiNothingToExplain') });
    const answer =
      task === 'summary'
        ? await summarize(text.discussion, language)
        : await ask(FAILURE_INSTRUCTION, text.failures, language);
    put({ loading: false, text: answer.trim() });
  } catch (error) {
    const reason =
      error instanceof GitHubError ? error.message : String((error as Error)?.message ?? error);
    put({ loading: false, error: t('aiFailed', reason) });
  }
}
