import { useSync } from '@/hooks/useSync';

const LABEL = {
  live: 'Sincronizado',
  connecting: 'Conectando…',
  offline: 'Sem conexão',
  error: 'Tempo real indisponível',
} as const;

export function SyncIndicator() {
  const { state, busy } = useSync();
  const color =
    state === 'live' ? 'bg-income' : state === 'offline' ? 'bg-expense' : state === 'error' ? 'bg-warn' : 'bg-muted';
  const title =
    state === 'error'
      ? 'Atualização automática indisponível; os dados são recarregados ao focar a janela.'
      : state === 'offline'
        ? 'Sem internet: nenhuma alteração pode ser salva até a conexão voltar.'
        : LABEL[state];
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted" title={title} role="status">
      <span className={`h-2 w-2 rounded-full ${color} ${busy ? 'animate-pulse' : ''}`} />
      {busy && state === 'live' ? 'Atualizando…' : LABEL[state]}
    </span>
  );
}

export function OfflineBanner() {
  const { online } = useSync();
  if (online) return null;
  return (
    <div role="alert" className="bg-expense/15 px-4 py-2 text-center text-sm">
      <strong className="text-expense">Sem conexão.</strong> Os valores exibidos podem estar desatualizados e nenhuma
      alteração será salva até a conexão voltar.
    </div>
  );
}
