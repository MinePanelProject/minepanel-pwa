import type { ReactNode } from 'react';

type AlertKind = 'error' | 'warning' | 'info' | 'success';

type AlertProps = {
  kind?: AlertKind;
  /** Use `role="status"` for success feedback; errors default to `alert`. */
  role?: 'alert' | 'status';
  title?: string;
  children: ReactNode;
};

const kindClasses: Record<AlertKind, { box: string; border: string }> = {
  error: { box: 'bg-danger-dim text-danger-ink', border: 'border-danger' },
  warning: { box: 'bg-warning-dim text-warning-ink', border: 'border-warning' },
  info: { box: 'bg-info-dim text-info-ink', border: 'border-info' },
  success: { box: 'bg-accent-dim text-success-ink', border: 'border-accent' },
};

/**
 * Inline feedback block. Never renders raw backend payloads: callers pass
 * already-sanitized copy (see `getApiErrorMessage`).
 */
export const Alert = ({ kind = 'info', role, title, children }: AlertProps): React.JSX.Element => {
  const effectiveRole = role ?? (kind === 'error' ? 'alert' : 'status');
  const classes = kindClasses[kind];

  return (
    <div className={`border-l-4 px-4 py-3 text-sm leading-6 ${classes.box} ${classes.border}`} role={effectiveRole}>
      {title && <p className="pixel-label mb-1 text-ink">{title}</p>}
      {children}
    </div>
  );
};