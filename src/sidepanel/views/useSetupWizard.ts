import { useState } from 'preact/hooks';
import type { SectionKind } from '../../lib/model';
import { finishSetup, saveSetupStep } from '../../lib/storage/onboarding';
import { showToast } from '../components/ui/Toast';
import { navigate } from '../state/router';
import { saveSettings } from '../state/settings';
import { onboarding, settings } from '../state/store';
export type Preset = Exclude<SectionKind, 'custom'>;

function useSetupDraft() {
  const [step, setStep] = useState<0 | 1 | 2>(
    onboarding.value?.status === 'pending' ? onboarding.value.nextStep : 0,
  );
  const [selected, setSelected] = useState<Preset[]>(() =>
    settings.value.sections
      .filter((section) => section.kind !== 'custom' && section.enabled)
      .map((section) => section.kind as Preset),
  );
  const [unfollowed, setUnfollowed] = useState<string[]>(settings.value.unfollowedTeams);
  const [teamsChanged, setTeamsChanged] = useState(false);
  const [notifications, setNotifications] = useState(settings.value.notifications.enabled);
  const [busy, setBusy] = useState(false);

  function toggle(kind: Preset, enabled: boolean) {
    setSelected((previous) =>
      enabled
        ? [...previous.filter((item) => item !== kind), kind]
        : previous.filter((item) => item !== kind),
    );
  }

  function followTeam(key: string, enabled: boolean) {
    setTeamsChanged(true);
    setUnfollowed((previous) =>
      enabled
        ? previous.filter((item) => item !== key)
        : [...previous.filter((item) => item !== key), key],
    );
  }

  return {
    step,
    setStep,
    selected,
    unfollowed,
    teamsChanged,
    notifications,
    setNotifications,
    busy,
    setBusy,
    toggle,
    followTeam,
  };
}

async function saveChoices({
  step,
  selected,
  teamsChanged,
  unfollowed,
  notifications,
}: ReturnType<typeof useSetupDraft>) {
  if (step === 0) {
    if (selected.length === 0) return false;
    const saved = await saveSettings(
      (current) => ({
        ...current,
        sections: current.sections.map((section) =>
          section.kind === 'custom'
            ? section
            : { ...section, enabled: selected.includes(section.kind) },
        ),
        // Preserve previous exclusions when the user has not changed any team selection.
        unfollowedTeams: teamsChanged ? unfollowed : current.unfollowedTeams,
      }),
      { refresh: true },
    );
    if (!saved) return false;
  } else if (step === 1) {
    const saved = await saveSettings((current) => ({
      ...current,
      notifications: { ...current.notifications, enabled: notifications },
    }));
    if (!saved) return false;
  }
  return true;
}

export function useSetupWizard() {
  const draft = useSetupDraft();
  const { step, setStep, busy, setBusy } = draft;

  async function next() {
    if (busy) return;
    setBusy(true);
    try {
      if (step === 2) {
        await finishSetup('completed');
        navigate('list');
        return;
      }
      if (!(await saveChoices(draft))) return;
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

  return { ...draft, next, back, skip };
}
