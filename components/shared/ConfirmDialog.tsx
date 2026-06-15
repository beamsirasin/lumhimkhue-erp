'use client';

import { useState } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  message,
  confirmLabel = 'ตกลง',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-foreground mb-5 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted/30"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-primary hover:bg-primary/90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmState {
  open: boolean;
  message: string;
  confirmLabel: string;
  variant: 'danger' | 'default';
  onConfirm: () => void;
}

const CLOSED: ConfirmState = {
  open: false,
  message: '',
  confirmLabel: 'ตกลง',
  variant: 'danger',
  onConfirm: () => {},
};

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>(CLOSED);

  function openConfirm(
    message: string,
    onConfirm: () => void,
    options?: { confirmLabel?: string; variant?: 'danger' | 'default' },
  ) {
    setState({
      open: true,
      message,
      confirmLabel: options?.confirmLabel ?? 'ตกลง',
      variant: options?.variant ?? 'danger',
      onConfirm,
    });
  }

  function close() {
    setState(CLOSED);
  }

  const dialog = (
    <ConfirmDialog
      open={state.open}
      message={state.message}
      confirmLabel={state.confirmLabel}
      variant={state.variant}
      onConfirm={() => { state.onConfirm(); close(); }}
      onCancel={close}
    />
  );

  return { openConfirm, dialog };
}
