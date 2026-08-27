import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';

type FieldBase = {
  label: string;
  hint?: string;
  error?: string;
  /** Accessible description that overrides the hint. */
  describedBy?: string;
};

type TextFieldProps = FieldBase &
  InputHTMLAttributes<HTMLInputElement> & {
    as?: 'input';
  };

type SelectFieldProps = FieldBase &
  SelectHTMLAttributes<HTMLSelectElement> & {
    as: 'select';
    children: ReactNode;
  };

const sharedFieldClasses =
  'mp-field w-full border-2 border-line-strong bg-bg px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none aria-invalid:border-danger';

/**
 * Labeled form control. `error` renders an accessible inline message and
 * marks the control `aria-invalid`. Autocomplete attributes pass through for
 * password-manager compatibility.
 */
export const Field = (props: TextFieldProps | SelectFieldProps): React.JSX.Element => {
  const { label, hint, error, describedBy, id } = props;
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const ariaDescribedBy = describedBy ?? errorId ?? hintId;

  return (
    <label className="grid gap-2" htmlFor={id}>
      <span className="font-bold text-ink">{label}</span>
      {'as' in props && props.as === 'select' ? (
        <select
          {...props}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={ariaDescribedBy}
          className={`${sharedFieldClasses} cursor-pointer ${props.className ?? ''}`}
        />
      ) : (
        <input
          {...props}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={ariaDescribedBy}
          className={`${sharedFieldClasses} ${props.className ?? ''}`}
        />
      )}
      {error ? (
        <span className="text-sm font-bold text-danger" id={errorId} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="text-sm text-ink-muted" id={hintId}>
          {hint}
        </span>
      ) : null}
    </label>
  );
};