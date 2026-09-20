import type { ReactNode } from 'react';
import { CardButton } from './CardButton';
import './segmented-card.css';

export function SegmentedCard({
  label,
  value,
  description,
  selected,
  onClick,
  className = '',
  filter,
}: {
  label: string;
  value: ReactNode;
  description: string;
  selected: boolean;
  onClick(): void;
  className?: string;
  filter?: string;
}) {
  return (
    <CardButton
      className={`segmented-card ${className} ${selected ? 'is-active' : ''}`}
      selected={selected}
      onClick={onClick}
      data-filter={filter}
    >
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{description}</span>
    </CardButton>
  );
}
