import { fireEvent, render, screen } from '@testing-library/preact';
import { KebabHorizontalIcon } from '../icons';
import { IconButton } from './IconButton';
import { Menu, type MenuEntry, type MenuProps } from './Menu';

export function setup(props: Partial<MenuProps> = {}) {
  const calls: string[] = [];
  const item = (id: string, label: string, extra = {}) => ({
    id,
    label,
    onSelect: () => calls.push(id),
    ...extra,
  });
  const items: MenuEntry[] = [
    item('open', 'Open in GitHub', { hint: 'o' }),
    item('copy', 'Copy branch name'),
    item('snooze', 'Snooze', { disabled: true }),
    'separator',
    item('mute', 'Mute notifications', { icon: <KebabHorizontalIcon /> }),
    item('close', 'Close pull request', { danger: true }),
  ];
  render(
    <div>
      <button type="button">Elsewhere</button>
      <Menu
        items={items}
        trigger={(p) => (
          <IconButton {...p} label="More actions">
            <KebabHorizontalIcon />
          </IconButton>
        )}
        {...props}
      />
    </div>,
  );
  const trigger = screen.getByRole('button', { name: 'More actions' });
  return { trigger, calls };
}

export const menu = () => screen.queryByRole('menu');
export const focused = () => document.activeElement?.textContent;
export const key = (k: string, target: Element = document.activeElement as Element) =>
  fireEvent.keyDown(target, { key: k });
