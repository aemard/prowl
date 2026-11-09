import type { AuthState } from '../lib/model';
import { PENDING_NOTICE } from '../lib/storage/onboarding';
import { installFakeChrome } from '../test/chrome';
import { installMockApi } from './mockApi';
import './preview.css';

async function start() {
  const fake = installFakeChrome();
  installMockApi();
  fake.runtime.getURL = (path) => new URL(path, location.origin).href;
  fake.tabs.create = async (props) => {
    if (props.url) window.open(props.url, '_blank', 'noopener,noreferrer');
    return { id: 1, ...props } as Awaited<ReturnType<typeof fake.tabs.create>>;
  };
  fake.runtime.sendMessage = (message) =>
    new Promise((resolve) => {
      const results = fake.runtime.onMessage.emit(message, { id: fake.runtime.id }, () =>
        resolve(undefined),
      );
      if (!results.includes(true)) resolve(undefined);
    });
  const auth: AuthState = {
    method: 'pat',
    token: 'ghp_mock_preview',
    tokenType: 'classic',
    scopes: ['repo', 'read:org'],
    viewer: { login: 'octocat', name: 'Demo User', avatarUrl: '' },
    createdAt: new Date().toISOString(),
  };
  await fake.storage.local.set(
    location.hash === '#onboarding' ? { onboarding: PENDING_NOTICE } : { auth },
  );
  const { registerBackground } = await import('../background/register');
  const { poll } = await import('../background/poller');
  registerBackground();
  await poll({ force: true });
  await import('../sidepanel/main');
}

void start();
