import { useEffect } from 'preact/hooks';
import { t } from '../../lib/i18n';
import type { PullRequest } from '../../lib/model';
import { type AiTask, aiAnswers, aiState, answerKey, checkAi, runAi } from '../state/localAi';
import { Button } from './ui/Button';
import './LocalAi.css';

const HEADINGS: Record<AiTask, 'aiSummaryHeading' | 'aiExplanationHeading'> = {
  summary: 'aiSummaryHeading',
  failure: 'aiExplanationHeading',
};

function Answer({ pr, task }: { pr: PullRequest; task: AiTask }) {
  const answer = aiAnswers.value[answerKey(pr, task)];
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
 * turned it on in Settings and Chrome has the model ready. Nothing leaves the device but the
 * GitHub read of the PR's own text.
 */
export function LocalAi({ pr }: { pr: PullRequest }) {
  const { availability } = aiState.value;
  useEffect(() => {
    if (availability === undefined) void checkAi();
  }, [availability]);
  if (availability !== 'available') return null;
  const loading = (task: AiTask) => aiAnswers.value[answerKey(pr, task)]?.loading === true;
  const busy = loading('summary') || loading('failure');
  return (
    <div class="local-ai" aria-busy={busy}>
      <fieldset class="local-ai__actions" aria-label={t('aiAssistant')}>
        <Button size="sm" loading={loading('summary')} onClick={() => void runAi(pr, 'summary')}>
          {t('aiSummarize')}
        </Button>
        {pr.checks.state === 'failure' && (
          <Button size="sm" loading={loading('failure')} onClick={() => void runAi(pr, 'failure')}>
            {t('aiExplainFailure')}
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
