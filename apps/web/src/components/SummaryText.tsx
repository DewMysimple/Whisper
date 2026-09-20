import type { ReactNode } from 'react';
import './summary-text.css';

/** A display-only label/value pair. Icons, actions and business state belong to the caller. */
export function SummaryText({
  label,
  value,
  description,
}: {
  label: string;
  value: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="summary-text">
      <small className="summary-label">{label}</small>
      <strong className="summary-value">{value}</strong>
      {description !== undefined && <span className="summary-description">{description}</span>}
    </div>
  );
}
