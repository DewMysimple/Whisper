import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  tone?: 'default' | 'danger';
  children?: ReactNode;
  onCancel(): void;
  onConfirm(): void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  pending = false,
  tone = 'default',
  children,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onCancel, open, pending]);

  if (!open) return null;

  return createPortal(
    <div
      className="confirm-backdrop"
      onMouseDown={() => {
        if (!pending) onCancel();
      }}
    >
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="confirm-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <span className="confirm-dialog-mark" aria-hidden="true">
            <AlertTriangle size={19} />
          </span>
          <div>
            <p className="step-label">CONFIRM ACTION</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            aria-label="关闭确认弹窗"
            className="round-button"
            disabled={pending}
            onClick={onCancel}
            type="button"
          >
            <X size={17} />
          </button>
        </header>
        <p className="confirm-dialog-description" id={descriptionId}>
          {description}
        </p>
        {children && <div className="confirm-dialog-details">{children}</div>}
        <footer>
          <button
            className="secondary-button"
            disabled={pending}
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={`primary-button ${tone === 'danger' ? 'is-danger' : ''}`}
            disabled={pending}
            onClick={onConfirm}
            type="button"
          >
            {pending ? '正在处理…' : confirmLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
