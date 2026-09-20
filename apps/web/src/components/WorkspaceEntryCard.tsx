import type { ComponentPropsWithRef, ReactNode } from 'react';
import { CardButton } from './CardButton';
import './workspace-entry-card.css';

/** Shared path intake / configuration entry surface; the caller owns the action. */
export function WorkspaceEntryCard({
  icon,
  label,
  title,
  description,
  className = '',
  ...props
}: Omit<ComponentPropsWithRef<'button'>, 'title' | 'children'> & {
  icon: ReactNode;
  label: string;
  title: string;
  description: string;
}) {
  return (
    <CardButton {...props} className={`workspace-entry-card ${className}`}>
      <span className="workspace-entry-label">
        {icon}
        {label}
      </span>
      <span className="workspace-entry-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
    </CardButton>
  );
}
