import type { ReactNode } from 'react';

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export const EmptyState = ({ title, description, action }: EmptyStateProps): React.JSX.Element => (
  <div className="empty-state panel-surface p-6 text-center">
    <h3 className="text-lg font-bold text-ink">{title}</h3>
    {description && <p className="mx-auto mt-3 max-w-md leading-7 text-ink-muted">{description}</p>}
    {action && <div className="mt-6 flex justify-center">{action}</div>}
  </div>
);