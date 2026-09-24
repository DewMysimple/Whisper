import type { ComponentPropsWithRef } from 'react';
import './button.css';

type NativeButtonProps = ComponentPropsWithRef<'button'>;

/** Shared native actions; layout and business state stay with the caller. */
export function Button({
  variant = 'secondary',
  tone = 'default',
  surface = 'raised',
  motion = false,
  className = '',
  children,
  ...props
}: NativeButtonProps & {
  variant?: 'primary' | 'secondary';
  tone?: 'default' | 'danger';
  surface?: 'raised' | 'flat';
  /** Animate the inner content and surface while keeping the hit area fixed. */
  motion?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${variant}-button ${tone === 'danger' ? 'is-danger' : ''} ${surface === 'flat' ? 'button-flat' : ''} ${motion ? 'button-motion' : ''} ${className}`}
      {...props}
    >
      {motion ? <span className="button-motion-content">{children}</span> : children}
    </button>
  );
}

/** Quiet icon actions share one hit area, focus treatment and danger state. */
export function IconButton({
  label,
  tone = 'default',
  className = '',
  children,
  ...props
}: Omit<NativeButtonProps, 'aria-label'> & {
  label: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      className={`icon-action ${className}`}
      aria-label={label}
      data-tone={tone}
      {...props}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
