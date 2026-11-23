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
import { GitHubError } from '../../lib/github/errors';
import { fetchPullRequestText } from '../../lib/github/fetchPullRequestText';
import { t, uiLocale } from '../../lib/i18n';
import type { PullRequest, PullRequestDetail } from '../../lib/model';
import { readClient } from './readClient';
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
  /** What it was asked for (`askedFor`). */
  for: AskedFor;
}
/** `<PR id>:<task>` -> its latest answer; `answerOf` says whether it still fits the PR. */
export const aiAnswers = signal<Record<string, AiAnswer>>({});

interface AskedFor {
  version: string;
  /** The failing check runs, where the card's detail listed them. */
  runs?: string;
}

/** What runs now, so that an account change stops it. */
const running = new Set<AbortController>();
onAccountChange(() => {
  for (const controller of running) controller.abort();
  running.clear();
  aiAnswers.value = {};
});

/**
 * What an answer is given for: a summary for the PR's text as last updated (a comment, review or
 * edit moves `updatedAt`, a push without new words too), an explanation for the failing checks of
 * the head commit, by count and, where the card's detail lists them, by identity (a re-run is a
 * new check run with its own page, even with the same count).
 */
function askedFor(pr: PullRequest, task: AiTask, detail?: PullRequestDetail): AskedFor {
  if (task === 'summary') return { version: pr.updatedAt };
  const runs = detail?.checks
    .filter(({ state }) => state === 'failed')
    .map(({ url, name }) => url ?? name)
    .join(' ');
  return { version: `${pr.headSha}:${pr.checks.failed}`, runs };
}

/**
 * The answer for `pr` as it is now, if any. Whether the card's detail had loaded when the user
 * asked, or has now, does not matter: the runs are compared only when both sides know them.
 * Anything else changed, it is no longer shown and the button asks again.
 */
export function answerOf(
  pr: PullRequest,
  task: AiTask,
  detail?: PullRequestDetail,
): AiAnswer | undefined {
  const answer = aiAnswers.value[`${pr.id}:${task}`];
  const now = askedFor(pr, task, detail);
  const asked = answer?.for;
  if (asked?.version !== now.version) return undefined;
  return asked.runs === undefined || now.runs === undefined || asked.runs === now.runs
    ? answer
    : undefined;
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
  const key = `${pr.id}:${task}`;
  if (!session || !models || answerOf(pr, task, detail)?.loading) return;
  const controller = new AbortController();
  running.add(controller);
  const started = startTask(task, models, uiLocale(), { signal: controller.signal });
  started.catch(() => {});
  // Asked for the PR as it was at the click, whenever the detail arrives.
  const request: AiAnswer = { loading: true, for: askedFor(pr, task, detail) };
  aiAnswers.value = { ...aiAnswers.value, [key]: request };
  const put = (answer: Omit<AiAnswer, 'for'>) => {
    if (auth.value === session && aiAnswers.value[key] === request)
      aiAnswers.value = { ...aiAnswers.value, [key]: { ...answer, for: request.for } };
  };
  try {
    const client = readClient(session.token);
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
