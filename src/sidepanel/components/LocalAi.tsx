import { useEffect } from 'preact/hooks';
import { taskAvailability } from '../../lib/ai/builtInAi';
import { t } from '../../lib/i18n';
import type { PullRequest } from '../../lib/model';
import { type AiTask, aiState, answerOf, checkAi, runAi } from '../state/localAi';
import { detailOf } from '../state/prDetail';
import { Button } from './ui/Button';
import './LocalAi.css';

const HEADINGS: Record<AiTask, 'aiSummaryHeading' | 'aiExplanationHeading'> = {
  summary: 'aiSummaryHeading',
  failure: 'aiExplanationHeading',
};

function Answer({ pr, task }: { pr: PullRequest; task: AiTask }) {
  const answer = answerOf(pr, task, detailOf(pr).detail);
  if (!answer || answer.loading) return null;
  if (answer.error)
    return (
      <p class="local-ai__error" role="alert">
        {answer.error}
      </p>
    );
  return (
    <section class="local-ai__answer" aria-label={t(HEADINGS[task])}>
      <p class="local-ai__heading">{t(HEADINGS[task])}</p>
      {/* Untrusted model output about untrusted GitHub text: plain text, never markup. */}
      <p class="local-ai__text">{answer.text}</p>
      <p class="local-ai__note">{t('aiGeneratedNote')}</p>
    </section>
  );
}

/**
 * Summaries and CI explanations from Chrome's on-device AI, in an expanded card, when the user
 * turned it on in Settings and Chrome has a model ready. Each button shows when the model of its
 * task is on the device or can be downloaded (`taskAvailability`): a click downloads it then.
 * Nothing leaves the device but the GitHub read of the PR's own text.
 */
export function LocalAi({ pr }: { pr: PullRequest }) {
  const { availability, models } = aiState.value;
  const { detail } = detailOf(pr);
  useEffect(() => {
    if (availability === undefined) void checkAi();
  }, [availability]);
  if (availability !== 'available' || !models) return null;
  const offered = (task: AiTask) => taskAvailability(task, models) !== 'unavailable';
  const entry = (task: AiTask) => answerOf(pr, task, detail);
  const loading = (task: AiTask) => entry(task)?.loading === true;
  // An answer for the PR as it is now can be asked for again: the model may answer better.
  const answered = (task: AiTask) => entry(task)?.text !== undefined;
  const busy = loading('summary') || loading('failure');
  return (
    <div class="local-ai" aria-busy={busy}>
      <fieldset class="local-ai__actions" aria-label={t('aiAssistant')}>
        {offered('summary') && (
          <Button
            size="sm"
            loading={loading('summary')}
            onClick={() => void runAi(pr, 'summary', detail)}
          >
            {answered('summary') ? t('aiSummarizeAgain') : t('aiSummarize')}
          </Button>
        )}
        {pr.checks.state === 'failure' && offered('failure') && (
          <Button
            size="sm"
            loading={loading('failure')}
            onClick={() => void runAi(pr, 'failure', detail)}
          >
            {answered('failure') ? t('aiExplainAgain') : t('aiExplainFailure')}
          </Button>
        )}
      </fieldset>
      {busy && (
        <span class="sr-only" role="status">
          {t('aiWorking')}
        </span>
      )}
      <Answer pr={pr} task="summary" />
      <Answer pr={pr} task="failure" />
    </div>
  );
}
