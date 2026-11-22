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
/** `answerKey` -> answer. */
export const aiAnswers = signal<Record<string, AiAnswer>>({});
/**
 * What an answer was given for: a summary for the PR's text as last updated (a comment, review or
 * edit moves `updatedAt`, a push without new words too), an explanation for the head commit and
 * its failing checks. Anything else changed, the answer is no longer shown and the button asks again.
 */
export const answerKey = (pr: PullRequest, task: AiTask) =>
  task === 'summary'
    ? `${pr.id}:summary:${pr.updatedAt}`
    : `${pr.id}:failure:${pr.headSha}:${pr.checks.failed}`;

const FAILURE_INSTRUCTION =
  'From these reports of failing CI checks, explain in at most four short sentences what failed and the most likely fix. Name files and lines when the reports give them.';

/** What the panel says when an answer failed: Chrome's own words are English and technical. */
function aiError(error: unknown): string {
  if (error instanceof GitHubError) return t('aiFailed', error.message);
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return t('aiTooLong');
  return t('aiFailed', error instanceof Error ? error.message : String(error));
}

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
    if (task === 'failure' && text.failures.length === 0)
      return put({ loading: false, text: t('aiNothingToExplain') });
    const answer =
      task === 'summary'
        ? await summarize({ lead: text.description, items: text.discussion }, language)
        : await ask(FAILURE_INSTRUCTION, { lead: '', items: text.failures }, language);
    put({ loading: false, text: answer.trim() });
  } catch (error) {
    put({ loading: false, error: aiError(error) });
  }
}
