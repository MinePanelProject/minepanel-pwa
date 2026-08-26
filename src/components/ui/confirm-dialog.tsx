import { type ReactNode, useEffect, useRef } from 'react';
import { Button } from './button';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** Body copy; callers provide sanitized text only. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Accessible confirmation dialog built on the native `<dialog>` element
 * (focus trap, Escape handling, and top-layer semantics come from the
 * browser). Destructive actions MUST route through this component with an
 * explicit identification of the target in `children`.
 */
export const ConfirmDialog = ({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="panel-surface-raised m-auto w-[min(28rem,calc(100vw-2rem))] p-0 text-ink backdrop:bg-black/60"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
    >
      <div className="p-6">
        <p className="pixel-title text-xs text-accent">[ Confirm ]</p>
        <h2 className="mt-3 text-xl font-bold">{title}</h2>
        <div className="mt-4 text-sm leading-6 text-ink-muted">{children}</div>
        <div className="mt-7 flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy} type="submit">
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
};