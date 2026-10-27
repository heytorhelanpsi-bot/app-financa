import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { formatCents } from '@/lib/money';
import { IconX } from './icons';

// -----------------------------------------------------------------------------
// Modal acessível baseado em <dialog>
// -----------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`m-0 mt-auto w-full max-w-none rounded-t-[2rem] border border-line/80 bg-surface p-0 text-fg shadow-2xl sm:m-auto sm:rounded-[2rem] ${
        wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'
      }`}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden />
          <header className="flex items-center justify-between gap-3 px-6 pb-2 pt-4">
            <h2 id={titleId} className="truncate text-lg font-semibold tracking-tight">
              {title}
            </h2>
            <button type="button" className="btn-ghost h-9 w-9 rounded-full px-0" onClick={onClose} aria-label="Fechar">
              <IconX width={18} height={18} />
            </button>
          </header>
          <div className="overflow-y-auto px-6 pb-5 pt-2">{children}</div>
          {footer && (
            <footer className="flex justify-end gap-2 border-t border-line/70 px-6 py-4 pb-safe [&>button]:min-w-[7rem]">{footer}</footer>
          )}
        </div>
      )}
    </dialog>
  );
}

// -----------------------------------------------------------------------------
// Formulário
// -----------------------------------------------------------------------------

export function Field({
  label,
  children,
  hint,
  error,
  htmlFor,
  className = '',
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && (
        <p className="mt-1 text-xs text-expense" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 flex gap-2 rounded-xl border border-expense/40 bg-expense/10 px-3.5 py-2.5 text-sm text-fg">
      <strong className="text-expense">Erro: </strong>
      {message}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Exibição
// -----------------------------------------------------------------------------

export function Money({
  cents,
  className = '',
  currency,
  signed,
}: {
  cents: number | string | null | undefined;
  className?: string;
  currency?: string;
  signed?: boolean;
}) {
  const n = Number(cents ?? 0);
  const text = formatCents(n, currency);
  return <span className={`tabular whitespace-nowrap ${className}`}>{signed && n > 0 ? `+${text}` : text}</span>;
}

export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <span className="mx-auto mb-3 block h-8 w-8 rounded-full bg-sunset opacity-80 blur-[1px]" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="card border-expense/40 text-sm">
      <p>
        <strong className="text-expense">Erro ao carregar os dados.</strong> Verifique a conexão.
      </p>
      {onRetry && (
        <button className="btn-secondary mt-3" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'danger' | 'warn' | 'ok' | 'soft-ok' | 'soft-warn' }) {
  const tones = {
    neutral: 'bg-surface-2 text-muted',
    danger: 'bg-expense/10 text-expense',
    warn: 'bg-warn/10 text-warn',
    ok: 'bg-income/10 text-income',
    'soft-ok': 'bg-income-forecast/10 text-income-forecast',
    'soft-warn': 'bg-expense-forecast/10 text-expense-forecast',
  } as const;
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 py-1.5">
      <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-line transition peer-checked:bg-accent peer-focus-visible:ring-4 peer-focus-visible:ring-accent/25
          after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4"
      />
      <span className="text-sm">
        {label}
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

// -----------------------------------------------------------------------------
// Confirmação
// -----------------------------------------------------------------------------

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={pending}>
            Voltar
          </button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={pending}>
            {pending ? 'Aguarde…' : confirmLabel}
          </button>
        </>
      }
    >
      <FormError message={error} />
      <div className="text-sm">{message}</div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Avisos (toasts)
// -----------------------------------------------------------------------------

interface ToastItem {
  id: number;
  text: string;
  tone: 'ok' | 'error';
}

const ToastContext = createContext<(text: string, tone?: 'ok' | 'error') => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
        {items.slice(-2).map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full border border-line/80 bg-surface/95 px-4 py-2.5 text-sm text-fg shadow-xl backdrop-blur"
          >
            <span className={`dot ${t.tone === 'error' ? 'bg-expense glow-dot-expense' : 'bg-income glow-dot-income'}`} aria-hidden />
            {t.tone === 'error' && <strong className="text-expense">Erro: </strong>}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
