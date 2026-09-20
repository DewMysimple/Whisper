import { useEffect, useState } from 'react';

/** Shared cancellation rules for repeat-click confirmations; no destructive action here. */
export function useTimedConfirmation<T extends { key: string }>() {
  const [armed, setArmed] = useState<T | null>(null);
  useEffect(() => {
    if (armed === null) return;
    const timeout = window.setTimeout(() => setArmed(null), 4000);
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setArmed(null);
    };
    const cancelOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const owner = event.target.closest('[data-confirm-action]');
      if (owner?.getAttribute('data-confirm-action') !== armed.key) setArmed(null);
    };
    document.addEventListener('keydown', cancelOnEscape);
    document.addEventListener('pointerdown', cancelOutside, true);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener('keydown', cancelOnEscape);
      document.removeEventListener('pointerdown', cancelOutside, true);
    };
  }, [armed]);
  return [armed, setArmed] as const;
}
