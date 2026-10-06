import type { ComponentChildren } from 'preact';
import './Settings.css';

/** One titled block of the settings screen. */
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
    <section class="settings-group">
      <h3 class="settings-group__title">{title}</h3>
      {description && <p class="settings-group__description">{description}</p>}
      {children}
    </section>
  );
}
