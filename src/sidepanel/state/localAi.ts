/**
 * The on-device AI as the panel sees it: what Chrome can run here, per model, the download's
 * progress, and the answers already given per pull request (kept until the panel closes or the
 * account changes, never stored).
 */
import { signal } from '@preact/signals';
import {
  type AiAvailability,
  type AiModels,
  type AiTask,
  aiModels,
  bestAvailability,
  downloadModel,
  startTask,
  taskAvailability,
} from '../../lib/ai/builtInAi';
import { env } from '../../lib/env';
import { createGitHubClient } from '../../lib/github/client';
import { GitHubError } from '../../lib/github/errors';
import { fetchPullRequestText } from '../../lib/github/fetchPullRequestText';
import { t, uiLocale } from '../../lib/i18n';
import type { PullRequest, PullRequestDetail } from '../../lib/model';
import { auth, onAccountChange } from './store';

export type { AiTask };

/**
 * Unknown until first checked: each model's state (`models`) and the readiest task's
 * (`availability`); `progress` (0-1) while this panel downloads the model.
 */
export const aiState = signal<{
  availability?: AiAvailability;
  models?: AiModels;
  progress?: number;
}>({});

export async function checkAi(): Promise<void> {
  const models = await aiModels(uiLocale());
  aiState.value = { ...aiState.value, models, availability: bestAvailability(models) };
}

/** Starts the one-time model download (from a click) and follows it to the end. */
export async function downloadAi(): Promise<void> {
  const { models } = aiState.value;
  aiState.value = { models, availability: 'downloading', progress: 0 };
  try {
    if (models)
      await downloadModel(models, uiLocale(), (progress) => {
        aiState.value = { models, availability: 'downloading', progress };
      });
  } catch {
    // Refused (no gesture, no disk space): the next check says what Chrome thinks now.
  }
  aiState.value = {};
  await checkAi();
}

export interface AiAnswer {
  loading: boolean;
  text?: string;
  error?: string;
}
/** `answerKey` -> answer. */
export const aiAnswers = signal<Record<string, AiAnswer>>({});

/** What runs now, so that an account change stops it. */
const running = new Set<AbortController>();
onAccountChange(() => {
  for (const controller of running) controller.abort();
  running.clear();
  aiAnswers.value = {};
});

/**
 * What an answer was given for: a summary for the PR's text as last updated (a comment, review or
 * edit moves `updatedAt`, a push without new words too), an explanation for the failing checks of
 * the head commit, by identity where the card's detail lists them (a re-run is a new check run
 * with its own page, even with the same count), else by count. Anything else changed, the answer
 * is no longer shown and the button asks again.
 */
export function answerKey(pr: PullRequest, task: AiTask, detail?: PullRequestDetail): string {
  if (task === 'summary') return `${pr.id}:summary:${pr.updatedAt}`;
  const failing = detail?.checks
    .filter(({ state }) => state === 'failed')
    .map(({ url, name }) => url ?? name)
    .join(' ');
  return `${pr.id}:failure:${pr.headSha}:${failing ?? pr.checks.failed}`;
}

/** What the panel says when an answer failed: Chrome's own words are English and technical. */
function aiError(error: unknown): string {
  if (error instanceof GitHubError) return t('aiFailed', error.message);
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return t('aiTooLong');
  if (error instanceof DOMException && error.name === 'NotAllowedError') return t('aiNeedsClick');
  return t('aiFailed', error instanceof Error ? error.message : String(error));
}

/**
 * Asks the on-device model about `pr` (from a click): creates the model's session at once, inside
 * the click (a model Chrome still has to download needs the gesture), reads the PR's text from
 * GitHub meanwhile, then answers. One request per key; it publishes only while its account is
 * signed in and it is still the key's latest request, and an account change aborts it.
 */
export async function runAi(
  pr: PullRequest,
  task: AiTask,
  detail?: PullRequestDetail,
): Promise<void> {
  const session = auth.value;
  const { models } = aiState.value;
  const key = answerKey(pr, task, detail);
  if (!session || !models || aiAnswers.value[key]?.loading) return;
  const controller = new AbortController();
  running.add(controller);
  const started = startTask(task, models, uiLocale(), { signal: controller.signal });
  started.catch(() => {});
  const request: AiAnswer = { loading: true };
  aiAnswers.value = { ...aiAnswers.value, [key]: request };
  const put = (answer: AiAnswer) => {
    if (auth.value === session && aiAnswers.value[key] === request)
      aiAnswers.value = { ...aiAnswers.value, [key]: answer };
  };
  try {
    const client = createGitHubClient({ token: session.token, apiUrl: env.apiUrl });
    const text = await fetchPullRequestText(client, pr.id);
    if (task === 'failure' && text.failures.length === 0)
      return put({ loading: false, text: t('aiNothingToExplain') });
    const run = await started;
    const answer = await run.answer(
      task === 'summary'
        ? { lead: text.description, items: text.discussion }
        : { lead: '', items: text.failures },
    );
    put({ loading: false, text: answer.trim() });
  } catch (error) {
    put({ loading: false, error: aiError(error) });
  } finally {
    running.delete(controller);
    void started.then(
      (run) => run.destroy(),
      () => {},
    );
    // A model this click downloaded is ready now: let the panel know.
    if (taskAvailability(task, models) !== 'available') void checkAi();
  }
}
