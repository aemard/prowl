import { PersonIcon } from '../icons';
import { cx } from './cx';
import './Avatar.css';

export interface AvatarProps {
  /** Image URL; without one (a deleted account) a person icon stands in. */
  src?: string | null;
  /** Tooltip, normally the login. The avatar itself is decorative: put the name in text. */
  title?: string;
  class?: string;
}

/** A round 16 px avatar. Decorative: whoever it shows is named in text beside it. */
export function Avatar({ src, title, class: className }: AvatarProps) {
  return src ? (
    <img
      class={cx('ui-avatar', className)}
      src={src}
      alt=""
      title={title}
      width="16"
      height="16"
      decoding="async"
    />
  ) : (
    <span class={cx('ui-avatar', className)} title={title} aria-hidden="true">
      <PersonIcon size={12} />
    </span>
  );
}
