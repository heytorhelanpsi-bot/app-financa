import { useSync } from '@/hooks/useSync';

const LABEL = {
  live: 'Sincronizado',
  connecting: 'Conectando…',
  offline: 'Sem conexão',
  error: 'Atualização manual',
} as const;

export function SyncIndicator({ compact }: { compact?: boolean }) {
  const { state, busy } = useSync();
  const color =
    state === 'live'
      ? 'bg-income glow-dot-income'
      : state === 'offline'
        ? 'bg-expense glow-dot-expense'
        : state === 'error'
          ? 'bg-warn'
          : 'bg-muted';
  const title =
    state === 'error'
      ? 'Atualização em tempo real indisponível; os dados são recarregados ao voltar para o app.'
      : state === 'offline'
        ? 'Sem internet: nenhuma alteração pode ser salva até a conexão voltar.'
        : LABEL[state];
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-line/70 bg-surface/60 px-2.5 py-1 text-[11px] font-medium text-muted"
      title={title}
      role="status"
      aria-label={title}
    >
      <span className={`dot h-1.5 w-1.5 ${color} ${busy ? 'animate-pulse' : ''}`} />
      {!compact && (busy && state === 'live' ? 'Atualizando…' : LABEL[state])}
    </span>
  );
}

export function OfflineBanner() {
  const { online } = useSync();
  if (online) return null;
  return (
    <div role="alert" className="border-b border-expense/30 bg-expense/10 px-4 py-2 text-center text-xs">
      <strong className="text-expense">Sem conexão.</strong> Os valores podem estar desatualizados e nenhuma alteração será
      salva até a conexão voltar.
    </div>
  );
}
