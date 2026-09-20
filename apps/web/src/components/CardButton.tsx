import type { ComponentPropsWithRef } from 'react';
import './card-button.css';

/** Native keyboard activation and transient feedback shared by all action cards.
 * Only actual choices opt into a persistent pressed state.
 */
export function CardButton({
  className = '',
  selected,
  ...props
}: ComponentPropsWithRef<'button'> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`card-button ${className}`}
      {...props}
    />
  );
}
