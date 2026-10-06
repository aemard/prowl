import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useId, useLayoutEffect, useRef } from 'preact/hooks';
import { XIcon } from '../icons';
import { cx, focusableIn } from './cx';
import { IconButton } from './IconButton';
import './Dialog.css';

export interface DialogProps {
  open: boolean;
  /** Called on Esc, the close button, a backdrop click, or a native close. */
  onClose: () => void;
  /** Sentence case; names the dialog. */
  title: string;
  /** Short explanation under the title; also the dialog's accessible description. */
  description?: ComponentChildren;
  children?: ComponentChildren;
  /** Action buttons, right-aligned. Put the least destructive one first. */
  footer?: ComponentChildren;
  /** Element focused on open. Defaults to the first focusable element in the body or footer. */
  initialFocus?: RefObject<HTMLElement>;
  /** Close when the backdrop is clicked (default true). */
  closeOnBackdrop?: boolean;
  class?: string;
}

/**
 * Modal dialog on the native `<dialog>` element: top layer, inert background, focus trapped
 * inside, Esc closes, and focus returns to whatever had it before opening.
 */
export function Dialog(props: DialogProps) {
  return props.open ? <OpenDialog {...props} /> : null;
}

function OpenDialog({
  onClose,
  title,
  description,
  children,
  footer,
  initialFocus,
  closeOnBackdrop = true,
  class: className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const active = useRef(true);
  const pressedBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Our own cleanup closes the native dialog too; that must not call onClose again.
  const requestClose = () => {
    if (active.current) onCloseRef.current();
  };

  useLayoutEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const content = dialog.querySelectorAll('.ui-dialog__body, .ui-dialog__footer');
    const first = [...content].flatMap((el) => focusableIn(el))[0];
    (initialFocus?.current ?? first ?? dialog).focus();
    return () => {
      active.current = false;
      if (dialog.open) dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const items = focusableIn(event.currentTarget);
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    if (!first || !last) {
      event.preventDefault();
    } else if (event.shiftKey && (current === first || current === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      class={cx('ui-dialog', className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      tabIndex={-1}
      onCancel={(event) => {
        // Esc: stay controlled by the parent instead of letting the browser close it.
        event.preventDefault();
        requestClose();
      }}
      onClose={requestClose}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (closeOnBackdrop && pressedBackdrop.current && event.target === event.currentTarget) {
          requestClose();
        }
        pressedBackdrop.current = false;
      }}
    >
      <div class="ui-dialog__panel">
        <div class="ui-dialog__header">
          <h2 id={titleId} class="ui-dialog__title">
            {title}
          </h2>
          <IconButton label="Close" size="sm" class="ui-dialog__close" onClick={requestClose}>
            <XIcon />
          </IconButton>
        </div>
        {description && (
          <p id={descriptionId} class="ui-dialog__description">
            {description}
          </p>
        )}
        {children && <div class="ui-dialog__body">{children}</div>}
        {footer && <div class="ui-dialog__footer">{footer}</div>}
      </div>
    </dialog>
  );
}
