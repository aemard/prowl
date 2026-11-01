import { useState } from 'preact/hooks';
import type { SectionKind } from '../../lib/model';
import { finishSetup, saveSetupStep } from '../../lib/storage/onboarding';
import { Button } from '../components/ui/Button';
import { Switch } from '../components/ui/Switch';
import { showToast } from '../components/ui/Toast';
import { navigate } from '../state/router';
import { saveSettings } from '../state/settings';
import { auth, onboarding, settings } from '../state/store';
import { PRESET_DESCRIPTIONS } from './SettingsModel';
import './SetupWizard.css';

type Preset = Exclude<SectionKind, 'custom'>;

const PRESETS: { kind: Preset; label: string }[] = [
  { kind: 'authored', label: 'Created by me' },
  { kind: 'review_requested', label: 'Review requested' },
  { kind: 'team_review_requested', label: 'Team reviews' },
  { kind: 'mentioned', label: 'Mentioned' },
  { kind: 'assigned', label: 'Assigned to me' },
];

const TITLES = ['Your pull requests', 'Notifications', "You're all set"] as const;

/** Three short steps, saving each choice only when Continue is pressed. */
export function SetupWizard() {
  const [step, setStep] = useState<0 | 1 | 2>(
    onboarding.value?.status === 'pending' ? onboarding.value.nextStep : 0,
  );
  const [selected, setSelected] = useState<Preset[]>(() =>
    settings.value.sections
      .filter((section) => section.kind !== 'custom' && section.enabled)
      .map((section) => section.kind as Preset),
  );
  const [notifications, setNotifications] = useState(settings.value.notifications.enabled);
  const [busy, setBusy] = useState(false);

  const insufficientTeamAccess =
    auth.value?.tokenType !== 'fine_grained' &&
    !auth.value?.scopes.includes('read:org');

  function toggle(kind: Preset, enabled: boolean) {
    setSelected((previous) =>
      enabled ? [...previous.filter((item) => item !== kind), kind] : previous.filter((item) => item !== kind),
    );
  }

  async function next() {
    if (busy) return;
    setBusy(true);
    try {
      if (step === 0) {
        if (selected.length === 0) return;
        const saved = await saveSettings(
          (current) => ({
            ...current,
            sections: current.sections.map((section) =>
              section.kind === 'custom'
                ? section
                : { ...section, enabled: selected.includes(section.kind) },
            ),
          }),
          { refresh: true },
        );
        if (!saved) return;
      } else if (step === 1) {
        const saved = await saveSettings((current) => ({
          ...current,
          notifications: { ...current.notifications, enabled: notifications },
        }));
        if (!saved) return;
      } else {
        await finishSetup('completed');
        navigate('list');
        return;
      }
      const following = (step + 1) as 1 | 2;
      await saveSetupStep(following);
      setStep(following);
    } catch {
      showToast({ message: 'Could not save setup progress. Try again.', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function back() {
    if (busy || step === 0) return;
    const previous = (step - 1) as 0 | 1;
    setBusy(true);
    try {
      await saveSetupStep(previous);
      setStep(previous);
    } catch {
      showToast({ message: 'Could not save setup progress. Try again.', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    if (busy) return;
    setBusy(true);
    try {
      await finishSetup('skipped');
      navigate('list');
    } catch {
      showToast({ message: 'Could not skip setup. Try again.', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="setup" aria-label="Set up Prowl">
      <div class="setup__heading">
        <p class="setup__eyebrow">GETTING STARTED · STEP {step + 1} OF 3</p>
        <div class="setup__progress" aria-label={'Step ' + (step + 1) + ' of 3'}>
          {TITLES.map((title, index) => (
            <span key={title} class="setup__progress-segment" data-active={index <= step} />
          ))}
        </div>
        <h2 class="setup__title">{TITLES[step]}</h2>
      </div>

      {step === 0 && (
        <div class="setup__content">
          <p class="setup__description">
            Choose which pull requests Prowl follows. You can change these anytime in Settings.
          </p>
          <div class="setup__choices">
            {PRESETS.map(({ kind, label }) => (
              <Switch
                key={kind}
                label={label}
                description={PRESET_DESCRIPTIONS[kind]}
                checked={selected.includes(kind)}
                onChange={(value) => toggle(kind, value)}
              />
            ))}
          </div>
          {selected.includes('team_review_requested') && insufficientTeamAccess && (
            <p class="setup__hint">
              Team reviews may require organization access (read:org). Prowl will show a
              warning if GitHub cannot discover your teams.
            </p>
          )}
          {selected.length === 0 && (
            <p class="setup__hint" role="status">Select at least one category to continue, or skip setup.</p>
          )}
        </div>
      )}

      {step === 1 && (
        <div class="setup__content">
          <p class="setup__description">
            Decide whether Prowl should notify you when a pull request changes.
          </p>
          <div class="setup__choices">
            <Switch
              label="Desktop notifications"
              description="CI failures, reviews, comments, approvals and merge status."
              checked={notifications}
              onChange={setNotifications}
            />
          </div>
          <p class="setup__hint">
            Notifications stay off unless you enable them. You can customize events and
            quiet hours later in Settings.
          </p>
        </div>
      )}

      {step === 2 && (
        <div class="setup__content setup__done">
          <p class="setup__description">
            Prowl is ready to keep an eye on your pull requests.
          </p>
          <ul class="setup__tips">
            <li><strong>Track your PRs.</strong> See CI, reviews and merge readiness at a glance.</li>
            <li><strong>Take action.</strong> Review, approve and merge right from the side panel.</li>
            <li><strong>Open anywhere.</strong> Use the Prowl keyboard shortcut.</li>
          </ul>
        </div>
      )}

      <div class="setup__actions">
        <Button variant="ghost" disabled={busy} onClick={() => void skip()}>
          Skip setup
        </Button>
        <div class="setup__navigation">
          {step > 0 && (
            <Button disabled={busy} onClick={() => void back()}>Back</Button>
          )}
          <Button
            variant="primary"
            loading={busy}
            disabled={step === 0 && selected.length === 0}
            onClick={() => void next()}
          >
            {step === 2 ? 'Open my pull requests' : 'Continue'}
          </Button>
        </div>
      </div>
    </section>
  );
}
