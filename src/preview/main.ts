import type { AuthState } from '../lib/model';
import { defaultSettings } from '../lib/storage/settings';
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
  const settings = defaultSettings();
  for (const section of settings.sections) {
    if (section.kind === 'review_requested') section.enabled = true;
  }
  await fake.storage.local.set({ auth, settings });
  const { registerBackground } = await import('../background/register');
  const { poll } = await import('../background/poller');
  registerBackground();
  await poll({ force: true });
  await import('../sidepanel/main');
  const { render, h } = await import('preact');
  const { AnimationControls } = await import('./AnimationControls');
  const controls = document.getElementById('preview-controls');
  if (controls) render(h(AnimationControls, {}), controls);
}

void start();
