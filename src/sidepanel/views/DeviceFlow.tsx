import { useEffect, useRef, useState } from 'preact/hooks';
import { env } from '../../lib/env';
import {
  type DeviceCode,
  DeviceFlowError,
  pollForToken,
  requestDeviceCode,
  validateDeviceToken,
} from '../../lib/github/auth/deviceFlow';
import { signInErrorMessage } from '../../lib/github/auth/pat';
import { t } from '../../lib/i18n';
import { AlertFillIcon, CopyIcon, LinkExternalIcon, MarkGithubIcon } from '../components/icons';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { showToast } from '../components/ui/Toast';
import { useNow } from '../components/useNow';
import { openGitHubUrl } from '../openUrl';
import { completeSignIn, releaseGitHubWebAccess } from '../state/session';
import './DeviceFlow.css';

const PERMISSION_DENIED = t('prowlNeedsAccessToGithubComToSignYou');

/** "Code expires in 14:52"; a timer role is not announced on every tick. */
function Countdown({ expiresAt }: { expiresAt: number }) {
  const seconds = Math.max(0, Math.ceil((expiresAt - useNow(1000)) / 1000));
  const rest = String(seconds % 60).padStart(2, '0');
  return (
    <p class="device-flow__expiry" role="timer">
      {t('codeCountdown', `${Math.floor(seconds / 60)}:${rest}`)}
    </p>
  );
}

async function completeDeviceFlow(
  controller: AbortController,
  setCode: (code: DeviceCode) => void,
) {
  const device = await requestDeviceCode({ signal: controller.signal });
  setCode(device);
  void openGitHubUrl(device.verificationUri);
  const token = await pollForToken(device, { signal: controller.signal });
  const { auth, warning } = await validateDeviceToken(token);
  controller.signal.throwIfAborted(); // cancelled while GitHub was checking the token
  await completeSignIn(auth, warning);
}

function useDeviceFlow(onTokenFallback?: () => void) {
  const [code, setCode] = useState<DeviceCode>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const flow = useRef<AbortController>();
  // Leaving the view (signed in with a token, route change) ends the flow.
  useEffect(() => () => flow.current?.abort(), []);
  /** Back to the start button, with `message` as the reason when there is one. */
  function reset(message?: string, offerToken = false) {
    flow.current = undefined;
    setCode(undefined);
    setStarting(false);
    setError(message);
    if (offerToken) onTokenFallback?.();
  }

  async function start() {
    if (flow.current) return;
    const controller = new AbortController();
    flow.current = controller;
    // Called before anything else: Chrome only prompts for a permission during the user gesture
    // of this click. Already granted (e2e builds, a second sign-in), it resolves without asking.
    const permission = chrome.permissions.request({ origins: [`${env.webUrl}/*`] });
    setError(undefined);
    setStarting(true);
    try {
      if (!(await permission)) return reset(PERMISSION_DENIED, true);
      await completeDeviceFlow(controller, setCode);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const known = failure instanceof DeviceFlowError;
      reset(
        known ? failure.message : signInErrorMessage(failure),
        known && (failure.reason === 'unsupported' || failure.reason === 'denied'),
      );
    } finally {
      // github.com is only needed while the flow runs; give the permission back afterwards.
      void releaseGitHubWebAccess();
    }
  }

  function cancel() {
    flow.current?.abort();
    reset();
  }
  return { code, starting, error, start, cancel };
}

async function copyCode(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast({ message: t('codeCopied'), tone: 'success', durationMs: 2000 });
  } catch {
    showToast({
      message: t('couldNotCopySelectTheCodeAndCopyIt'),
      tone: 'danger',
    });
  }
}

function DeviceCodePanel({ code, cancel }: { code: DeviceCode; cancel: () => void }) {
  const waiting = useRef<HTMLElement>(null);
  // The code panel replaces the start button: focus moves with the content (and back, below).
  useEffect(() => waiting.current?.focus(), []);
  return (
    <section
      class="device-flow__code-panel"
      aria-label={t('authorizeProwlOnGithub')}
      tabIndex={-1}
      ref={waiting}
    >
      <p>{t('enterThisCodeOnGithubToFinishSigningIn')}</p>
      <div class="device-flow__code-row">
        <code class="device-flow__code">{code.userCode}</code>
        <Button
          size="sm"
          icon={<CopyIcon size={12} />}
          onClick={() => void copyCode(code.userCode)}
          aria-label={t('copyCode', code.userCode)}
        >
          {t('copy')}
        </Button>
      </div>
      <Button
        variant="primary"
        icon={<LinkExternalIcon size={12} />}
        onClick={() => void openGitHubUrl(code.verificationUri)}
      >
        {t('openGithub')}
      </Button>
      <Countdown expiresAt={code.expiresAt} />
      <p class="device-flow__status" role="status">
        <Spinner size={12} />
        {t('waitingForYouToApproveProwlOnGithub')}
      </p>
      <Button variant="ghost" onClick={cancel}>
        {t('cancel')}
      </Button>
    </section>
  );
}

function StartDeviceFlow({ starting, start }: { starting: boolean; start: () => Promise<void> }) {
  return (
    <>
      <Button
        variant="primary"
        loading={starting}
        icon={<MarkGithubIcon size={16} />}
        onClick={() => void start()}
      >
        {t('continueWithGithub')}
      </Button>
      <p class="device-flow__hint">{t('approveProwlOnGithubComWithAOneTime')}</p>
    </>
  );
}

/** Continue with GitHub's device flow; only rendered when the build has an OAuth client id. */
export function DeviceFlow({ onTokenFallback }: { onTokenFallback?: () => void }) {
  const { code, starting, error, start, cancel } = useDeviceFlow(onTokenFallback);
  const root = useRef<HTMLDivElement>(null);
  const wasWaiting = useRef(false);
  const showingCode = code !== undefined;
  // Restore focus when the code panel gives way to the start button.
  useEffect(() => {
    if (!showingCode && wasWaiting.current) root.current?.querySelector('button')?.focus();
    wasWaiting.current = showingCode;
  }, [showingCode]);
  return (
    <div class="device-flow" ref={root}>
      {code ? (
        <DeviceCodePanel code={code} cancel={cancel} />
      ) : (
        <StartDeviceFlow starting={starting} start={start} />
      )}
      {error && (
        <p class="device-flow__error" role="alert">
          <AlertFillIcon size={12} />
          {error}
        </p>
      )}
    </div>
  );
}
