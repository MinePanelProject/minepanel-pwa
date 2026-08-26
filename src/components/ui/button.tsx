import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Spinner } from './spinner';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** Renders an inline spinner, disables the button, and marks it busy. */
  loading?: boolean;
  children: ReactNode;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-accent bg-accent-strong text-accent-ink hover:bg-accent disabled:hover:bg-accent-strong',
  secondary: 'border-line-strong bg-surface-raised text-ink hover:border-ink-muted',
  danger: 'border-danger bg-danger-dim text-ink hover:bg-danger-strong',
  ghost: 'border-transparent bg-transparent text-ink-muted hover:text-ink',
};

/**
 * Shared button. Minimum 44px touch target; loading state prevents duplicate
 * submission and announces progress for screen readers.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', loading = false, disabled, type = 'button', children, className, ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 border-2 px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]} ${className ?? ''}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  ),
);

Button.displayName = 'Button';