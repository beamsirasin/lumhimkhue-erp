'use client';

import { useEffect, useState } from 'react';

interface ManagerApprovalModalProps {
  open: boolean;
  description: string;
  contextLines?: string[];
  reasonRequired?: boolean;
  onCancel: () => void;
  onConfirm: (params: { code: string; reason: string }) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Phase 17POS-AUTH-A2 — cashier-facing approval-code prompt for sensitive
 * POS edits. Zone 2 (touch-friendly, no ReUI/admin patterns) — mirrors the
 * raw-overlay style of components/shared/ConfirmDialog.tsx so it works from
 * both PosTerminal.tsx (no shadcn Dialog usage) and TableGrid.tsx.
 *
 * Never shows any hint about the current active code — the server is the
 * sole source of truth and always returns the same generic rejection
 * message regardless of why a code failed.
 */
export function ManagerApprovalModal({
  open,
  description,
  contextLines = [],
  reasonRequired = true,
  onCancel,
  onConfirm,
}: ManagerApprovalModalProps) {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCode('');
      setReason('');
      setError('');
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const canSubmit = code.length === 6 && (!reasonRequired || reason.trim().length > 0) && !submitting;

  async function handleConfirm() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    const result = await onConfirm({ code, reason: reason.trim() });
    setSubmitting(false);
    if (!result.ok) setError(result.error || 'รหัสอนุมัติไม่ถูกต้องหรือหมดอายุ');
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4"
      onClick={() => { if (!submitting) onCancel(); }}
    >
      <div
        className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1.5 text-lg font-bold text-foreground">ต้องใช้รหัสอนุมัติ</h2>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{description}</p>

        {contextLines.length > 0 && (
          <div className="mb-4 space-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            {contextLines.map((line) => (
              <p key={line} className="text-xs text-foreground">{line}</p>
            ))}
          </div>
        )}

        <label className="mb-3 block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">รหัสอนุมัติ 6 ตัว</span>
          <input
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            className="w-full rounded-xl border border-border bg-background px-4 py-3.5 text-center font-mono text-2xl font-bold tracking-[0.3em] text-foreground focus:border-primary focus:outline-none"
            placeholder="XXXXXX"
            disabled={submitting}
            autoFocus
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">
            เหตุผล{reasonRequired ? '' : ' (ไม่บังคับ)'}
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            disabled={submitting}
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
            placeholder="เหตุผลในการแก้ไข"
          />
        </label>

        {error && (
          <p className="mb-3 rounded-lg bg-[var(--status-danger-bg)] px-3 py-2 text-sm text-[var(--status-danger-fg)]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-xl border border-border px-6 py-3.5 text-base text-foreground hover:bg-muted/30 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="rounded-xl bg-primary px-6 py-3.5 text-base font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? 'กำลังตรวจสอบ...' : 'ยืนยันการแก้ไข'}
          </button>
        </div>
      </div>
    </div>
  );
}
