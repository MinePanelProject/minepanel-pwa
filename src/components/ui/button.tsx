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
  primary: '',
  secondary: 'border-line-strong bg-surface-raised text-ink hover:border-accent hover:bg-surface',
  danger: 'border-danger bg-danger-dim text-ink hover:bg-danger-strong',
  ghost: 'border-transparent bg-transparent text-ink-muted hover:text-ink hover:border-line',
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
      className={`mp-button ${variant === 'primary' ? 'mp-button-primary' : ''} ${variant === 'secondary' ? 'mp-button-secondary' : ''} inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 border-2 px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]} ${className ?? ''}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  ),
);

Button.displayName = 'Button';