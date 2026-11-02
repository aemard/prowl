import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { fakeChrome } from '../../test/chrome';
import { SettingsGroup, settingsGroupId } from '../views/SettingsGroup';
import { Message } from './Message';

describe('localized markup', () => {
  it('keeps markup safe and allows a language to reorder a shortcut', () => {
    fakeChrome().__state.locale = 'ja';
    const { container } = render(<Message id="openWithShortcut" values={[<kbd>Ctrl+P</kbd>]} />);
    expect(container.textContent).toBe('Ctrl+P で Prowl を開けます。');
    expect(container.querySelector('kbd')?.textContent).toBe('Ctrl+P');
  });

  it('renders untrusted values as text', () => {
    const { container } = render(<Message id="openWithShortcut" values={['<img src=x>']} />);
    expect(container.textContent).toContain('<img src=x>');
    expect(container.querySelector('img')).toBeNull();
  });

  it('gives non-Latin settings headings distinct, navigable ids', () => {
    render(
      <>
        <SettingsGroup title="設定">A</SettingsGroup>
        <SettingsGroup title="通知">B</SettingsGroup>
      </>,
    );
    expect(settingsGroupId('設定')).not.toBe(settingsGroupId('通知'));
    const heading = screen.getByRole('heading', { name: '設定' });
    expect(document.querySelector(`#${settingsGroupId('設定')} > h3`)).toBe(heading);
  });
});
