import type { ComponentPropsWithRef } from 'react';
import './button.css';

type NativeButtonProps = ComponentPropsWithRef<'button'>;

/** Shared native actions; layout and business state stay with the caller. */
export function Button({
  variant = 'secondary',
  tone = 'default',
  className = '',
  ...props
}: NativeButtonProps & {
  variant?: 'primary' | 'secondary';
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      className={`${variant}-button ${tone === 'danger' ? 'is-danger' : ''} ${className}`}
      {...props}
    />
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
