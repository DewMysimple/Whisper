import type { ReactNode } from 'react';
import './preference-choice-card.css';

interface PreferenceChoiceCardProps {
  checked: boolean;
  children: ReactNode;
  className?: string;
  label: string;
  name: string;
  onChange(): void;
  value: string;
}

/** A native radio choice with the same card surface, focus, and selection feedback. */
export function PreferenceChoiceCard({
  checked,
  children,
  className = '',
  label,
  name,
  onChange,
  value,
}: PreferenceChoiceCardProps) {
  return (
    <label className={`preference-choice-card ${checked ? 'is-selected' : ''} ${className}`}>
      <input
        aria-label={label}
        checked={checked}
        name={name}
        onChange={onChange}
        type="radio"
        value={value}
      />
      {children}
      <span className="preference-choice-card-label">
        <strong>{label}</strong>
      </span>
    </label>
  );
}
