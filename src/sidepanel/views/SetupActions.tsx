import { Button } from '../components/ui/Button';
import type { useSetupWizard } from './useSetupWizard';
export function SetupActions({
  step,
  busy,
  selected,
  skip,
  back,
  next,
}: ReturnType<typeof useSetupWizard>) {
  return (
    <div class="setup__actions">
      <Button variant="ghost" disabled={busy} onClick={() => void skip()}>
        Skip setup
      </Button>
      <div class="setup__navigation">
        {step > 0 && (
          <Button disabled={busy} onClick={() => void back()}>
            Back
          </Button>
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
  );
}
