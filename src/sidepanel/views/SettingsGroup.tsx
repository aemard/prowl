import type { ComponentChildren } from 'preact';
import './Settings.css';

/** The id of the group titled `title`, which the settings screen's section links point at. */
export const settingsGroupId = (title: string) =>
  `settings-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;

/** One titled block of the settings screen. Its title takes focus when a section link jumps to it. */
export function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ComponentChildren;
}) {
  return (
    <section class="settings-group" id={settingsGroupId(title)}>
      <h3 class="settings-group__title" tabIndex={-1}>
        {title}
      </h3>
      {description && <p class="settings-group__description">{description}</p>}
      {children}
    </section>
  );
}
