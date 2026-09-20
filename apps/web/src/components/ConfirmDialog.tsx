import { AlertTriangle, X } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from './useDialogFocus';
import { Button, IconButton } from './Button';

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

  useDialogFocus(open, dialogRef, cancelRef, onCancel, pending);

  if (!open) return null;

  return createPortal(
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        event.stopPropagation();
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
          <IconButton label="关闭确认弹窗" disabled={pending} onClick={onCancel} type="button">
            <X size={17} />
          </IconButton>
        </header>
        <p className="confirm-dialog-description" id={descriptionId}>
          {description}
        </p>
        {children && <div className="confirm-dialog-details">{children}</div>}
        <footer>
          <Button disabled={pending} onClick={onCancel} ref={cancelRef} type="button">
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            tone={tone}
            disabled={pending}
            onClick={onConfirm}
            type="button"
          >
            {pending ? '正在处理…' : confirmLabel}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
