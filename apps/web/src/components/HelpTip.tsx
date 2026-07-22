import type { ReactNode } from 'react';

export function HelpTip({
  children,
  id,
  label,
  align = 'left',
}: {
  children: ReactNode;
  id: string;
  label: string;
  align?: 'left' | 'right';
}) {
  return (
    <span className="help-tip" data-align={align} data-placement="bottom">
      <button className="help-trigger" type="button" aria-describedby={id} aria-label={label}>
        ?
      </button>
      <span className="help-popover" id={id} role="tooltip">
        {children}
      </span>
    </span>
  );
}
