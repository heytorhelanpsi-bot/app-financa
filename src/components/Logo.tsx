import { useId } from 'react';

export function Logo({ compact, size = 36 }: { compact?: boolean; size?: number }) {
  // Id único por instância: o menu lateral oculto não pode "esconder" o degradê do cabeçalho.
  const gradientId = `logo-sun-${useId().replace(/:/g, '')}`;
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FBB931" />
            <stop offset="0.55" stopColor="#F88F22" />
            <stop offset="1" stopColor="#EA6113" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="12" fill="#1c1512" />
        <circle cx="25" cy="15" r="9" fill={`url(#${gradientId})`} />
        <path d="M8 29 15 22l5 4 12-11" fill="none" stroke="#FFE3B3" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!compact && (
        <span className="leading-tight">
          <span className="block text-sm font-bold tracking-tight">Financeiro</span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">Pessoal</span>
        </span>
      )}
    </span>
  );
}
