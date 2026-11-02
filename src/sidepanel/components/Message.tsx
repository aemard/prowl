import type { ComponentChildren } from 'preact';
import { type MessageKey, t } from '../../lib/i18n';

/** Named slots let translations reorder links and markup without interpreting HTML. */
export function Message({ id, values }: { id: MessageKey; values: ComponentChildren[] }) {
  const markers = values.map((_, index) => `\uE000${index}\uE001`);
  return (
    <>
      {t(id, ...markers)
        .split(/\uE000(\d+)\uE001/)
        .map((part, index) => (index % 2 ? values[Number(part)] : part))}
    </>
  );
}
