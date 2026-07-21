'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type PromptField = {
  /** Unique key returned in the resolved value map. */
  name: string;
  label: string;
  type?: 'text' | 'number' | 'textarea';
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  min?: number;
  step?: string;
  /** Return an error string to block submission, or null when valid. */
  validate?: (value: string, all: Record<string, string>) => string | null;
};

export type PromptConfig = {
  title: string;
  description?: ReactNode;
  fields: PromptField[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
};

type PromptState = PromptConfig & {
  open: boolean;
  resolve: ((value: Record<string, string> | null) => void) | null;
};

const CLOSED: PromptState = {
  open: false,
  title: '',
  fields: [],
  resolve: null,
};

/**
 * In-app replacement for window.prompt — supports one or more validated
 * text/number/textarea fields and resolves to a value map (or null on cancel).
 */
export function usePrompt() {
  const [state, setState] = useState<PromptState>(CLOSED);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const prompt = useCallback((config: PromptConfig) => {
    return new Promise<Record<string, string> | null>((resolve) => {
      const initial: Record<string, string> = {};
      for (const field of config.fields) initial[field.name] = field.defaultValue ?? '';
      setValues(initial);
      setError(null);
      setState({ ...config, open: true, resolve });
    });
  }, []);

  const close = useCallback(
    (result: Record<string, string> | null) => {
      state.resolve?.(result);
      setState(CLOSED);
      setError(null);
    },
    [state],
  );

  function handleSubmit() {
    for (const field of state.fields) {
      const raw = (values[field.name] ?? '').trim();
      if (field.required && !raw) {
        setError(`กรุณากรอก${field.label}`);
        return;
      }
      if (field.validate) {
        const message = field.validate(values[field.name] ?? '', values);
        if (message) {
          setError(message);
          return;
        }
      }
    }
    close({ ...values });
  }

  const dialog = (
    <Dialog open={state.open} onOpenChange={(next) => { if (!next) close(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          {state.description && (
            <DialogDescription>{state.description}</DialogDescription>
          )}
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          {state.fields.map((field, index) => {
            const value = values[field.name] ?? '';
            const onChange = (next: string) =>
              setValues((current) => ({ ...current, [field.name]: next }));
            return (
              <div key={field.name} className="space-y-1.5">
                <Label htmlFor={`prompt-${field.name}`}>
                  {field.label}
                  {field.required && <span className="ml-0.5 text-[var(--status-danger-fg)]">*</span>}
                </Label>
                {field.type === 'textarea' ? (
                  <Textarea
                    id={`prompt-${field.name}`}
                    autoFocus={index === 0}
                    value={value}
                    placeholder={field.placeholder}
                    onChange={(event) => onChange(event.target.value)}
                    rows={3}
                  />
                ) : (
                  <Input
                    id={`prompt-${field.name}`}
                    autoFocus={index === 0}
                    type={field.type === 'number' ? 'number' : 'text'}
                    inputMode={field.type === 'number' ? 'decimal' : undefined}
                    value={value}
                    placeholder={field.placeholder}
                    min={field.min}
                    step={field.step}
                    onChange={(event) => onChange(event.target.value)}
                  />
                )}
                {field.hint && (
                  <p className="text-xs text-muted-foreground">{field.hint}</p>
                )}
              </div>
            );
          })}
          {error && (
            <p className="text-sm text-[var(--status-danger-fg)]">{error}</p>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => close(null)}>
              {state.cancelLabel ?? 'ยกเลิก'}
            </Button>
            <Button
              type="submit"
              className={cn(
                state.variant === 'danger' &&
                  'bg-[var(--status-danger-fg)] text-white hover:bg-[var(--status-danger-fg)]/90',
              )}
            >
              {state.confirmLabel ?? 'ยืนยัน'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { prompt, dialog };
}

/**
 * Lightweight busy-aware confirm dialog (in-app, themed) for destructive or
 * significant actions that also need an async pending state.
 */
export function AsyncActionDialog({
  open,
  title,
  description,
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  variant = 'default',
  pending = false,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  pending?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            disabled={pending}
            className={cn(
              variant === 'danger' &&
                'bg-[var(--status-danger-fg)] text-white hover:bg-[var(--status-danger-fg)]/90',
            )}
            onClick={onConfirm}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
