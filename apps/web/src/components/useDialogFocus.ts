import { useEffect, useRef, type RefObject } from 'react';

const dialogStack: symbol[] = [];
let originalOverflow = '';

export function useDialogFocus(
  open: boolean,
  container: RefObject<HTMLElement | null>,
  initialFocus: RefObject<HTMLElement | null>,
  onClose: () => void,
  pending = false,
): void {
  const latest = useRef({ onClose, pending });
  latest.current = { onClose, pending };

  useEffect(() => {
    if (!open) return;
    const token = Symbol('dialog');
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialogStack.length === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    dialogStack.push(token);
    initialFocus.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (dialogStack.at(-1) !== token) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!latest.current.pending) latest.current.onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = container.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable?.[0];
      const last = focusable?.[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (
        !container.current?.contains(document.activeElement) ||
        (event.shiftKey && document.activeElement === first)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      const wasTop = dialogStack.at(-1) === token;
      dialogStack.splice(dialogStack.indexOf(token), 1);
      if (dialogStack.length === 0) document.body.style.overflow = originalOverflow;
      if (wasTop && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [container, initialFocus, open]);
}
