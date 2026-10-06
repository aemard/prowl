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
import { AlertFillIcon, CopyIcon, LinkExternalIcon, MarkGithubIcon } from '../components/icons';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { showToast } from '../components/ui/Toast';
import { useNow } from '../components/useNow';
import { openGitHubUrl } from '../openUrl';
import { completeSignIn } from '../state/session';
import './DeviceFlow.css';

const PERMISSION_DENIED =
  'Prowl needs access to github.com to sign you in from the browser: that is where it asks GitHub for the code and for your approval. Allow it and try again, or paste a token below, which needs no extra access.';

/** "Code expires in 14:52"; a timer role is not announced on every tick. */
function Countdown({ expiresAt }: { expiresAt: number }) {
  const seconds = Math.max(0, Math.ceil((expiresAt - useNow(1000)) / 1000));
  const rest = String(seconds % 60).padStart(2, '0');
  return (
    <p class="device-flow__expiry" role="timer">
      Code expires in {Math.floor(seconds / 60)}:{rest}
    </p>
  );
}

/** Sign in with GitHub's device flow; only rendered when the build has an OAuth client id. */
export function DeviceFlow() {
  const [code, setCode] = useState<DeviceCode>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const flow = useRef<AbortController>();
  const root = useRef<HTMLDivElement>(null);
  const waiting = useRef<HTMLElement>(null);
  const wasWaiting = useRef(false);

  // Leaving the view (signed in with a token, route change) ends the flow.
  useEffect(() => () => flow.current?.abort(), []);

  // The code panel replaces the start button: move focus with the content, and back.
  const showingCode = code !== undefined;
  useEffect(() => {
    if (showingCode) waiting.current?.focus();
    else if (wasWaiting.current) root.current?.querySelector('button')?.focus();
    wasWaiting.current = showingCode;
  }, [showingCode]);

  /** Back to the start button, with `message` as the reason when there is one. */
  function reset(message?: string) {
    flow.current = undefined;
    setCode(undefined);
    setStarting(false);
    setError(message);
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
      if (!(await permission)) return reset(PERMISSION_DENIED);
      const device = await requestDeviceCode({ signal: controller.signal });
      setCode(device);
      void openGitHubUrl(device.verificationUri);
      const token = await pollForToken(device, { signal: controller.signal });
      const { auth, warning } = await validateDeviceToken(token);
      controller.signal.throwIfAborted(); // cancelled while GitHub was checking the token
      await completeSignIn(auth, warning);
    } catch (failure) {
      if (controller.signal.aborted) return;
      reset(failure instanceof DeviceFlowError ? failure.message : signInErrorMessage(failure));
    }
  }

  function cancel() {
    flow.current?.abort();
    reset();
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast({ message: 'Code copied', tone: 'success', durationMs: 2000 });
    } catch {
      showToast({
        message: 'Could not copy. Select the code and copy it by hand.',
        tone: 'danger',
      });
    }
  }

  return (
    <div class="device-flow" ref={root}>
      {code ? (
        <section
          class="device-flow__code-panel"
          aria-label="Authorize Prowl on GitHub"
          tabIndex={-1}
          ref={waiting}
        >
          <p>Enter this code on GitHub to finish signing in.</p>
          <div class="device-flow__code-row">
            <code class="device-flow__code">{code.userCode}</code>
            <Button
              size="sm"
              icon={<CopyIcon size={12} />}
              onClick={() => void copy(code.userCode)}
              aria-label={`Copy code ${code.userCode}`}
            >
              Copy
            </Button>
          </div>
          <Button
            variant="primary"
            icon={<LinkExternalIcon size={12} />}
            onClick={() => void openGitHubUrl(code.verificationUri)}
          >
            Open GitHub
          </Button>
          <Countdown expiresAt={code.expiresAt} />
          <p class="device-flow__status" role="status">
            <Spinner size={12} />
            Waiting for you to approve Prowl on GitHub…
          </p>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </section>
      ) : (
        <>
          <Button
            variant="primary"
            loading={starting}
            icon={<MarkGithubIcon size={16} />}
            onClick={() => void start()}
          >
            Continue with GitHub
          </Button>
          <p class="device-flow__hint">
            Approve Prowl on github.com with a one-time code. Chrome first asks to let Prowl talk to
            github.com for that.
          </p>
        </>
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
