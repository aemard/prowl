import { useLayoutEffect, useRef } from 'preact/hooks';
import { SetupActions } from './SetupActions';
import { SetupCategories } from './SetupCategories';
import { SetupSummary } from './SetupSummary';
import { useSetupWizard } from './useSetupWizard';
import './SetupWizard.css';

const TITLES = ['Your pull requests', 'Notifications', "You're all set"] as const;
export function SetupWizard() {
  const wizard = useSetupWizard();
  const { step } = wizard;
  const titleRef = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    titleRef.current?.focus();
  }, [step]);

  return (
    <section class="setup" aria-label="Set up Prowl">
      <div class="setup__heading">
        <p class="setup__eyebrow">GETTING STARTED · STEP {step + 1} OF 3</p>
        <div
          class="setup__progress"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={step + 1}
        >
          {TITLES.map((title, index) => (
            <span key={title} class="setup__progress-segment" data-active={index <= step} />
          ))}
        </div>
        <h2 ref={titleRef} tabIndex={-1} class="setup__title">
          {TITLES[step]}
        </h2>
      </div>

      {step === 0 ? <SetupCategories {...wizard} /> : <SetupSummary {...wizard} />}

      <SetupActions {...wizard} />
    </section>
  );
}
