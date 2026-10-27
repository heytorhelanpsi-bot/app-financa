export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="relative flex h-8 w-8 items-center justify-center rounded-xl border border-line bg-surface-2">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
          <path d="M4 16 9.5 10.5l3.5 3.5L20 7" stroke="rgb(var(--income))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 20h16" stroke="rgb(var(--expense))" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight">Financeiro</span>
          <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-muted">Pessoal</span>
        </span>
      )}
    </span>
  );
}
