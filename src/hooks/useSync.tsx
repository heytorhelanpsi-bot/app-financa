import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useIsFetching, useIsMutating, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { invalidateFinancial, keys } from './data';

export type SyncState = 'offline' | 'connecting' | 'live' | 'error';

interface SyncInfo {
  state: SyncState;
  busy: boolean;
  online: boolean;
  lastEventAt: Date | null;
}

const SyncContext = createContext<SyncInfo>({ state: 'connecting', busy: false, online: true, lastEventAt: null });

/**
 * Sincronização entre dispositivos:
 *  1. Realtime do Supabase avisa alterações nas tabelas do usuário (RLS aplicado);
 *  2. ao receber um aviso, os dados são relidos do servidor (fonte da verdade);
 *  3. ao voltar a conexão ou o foco da janela, tudo é revalidado.
 */
export function SyncProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const qc = useQueryClient();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [channelState, setChannelState] = useState<SyncState>('connecting');
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const fetching = useIsFetching();
  const mutating = useIsMutating();

  useEffect(() => {
    const up = () => {
      setOnline(true);
      qc.invalidateQueries();
    };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [qc]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Agrupa rajadas de eventos (ex.: transferência gera duas linhas).
    const schedule = (table: string) => {
      setLastEventAt(new Date());
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (table === 'categories') qc.invalidateQueries({ queryKey: keys.categories });
        else if (table === 'profiles') qc.invalidateQueries({ queryKey: keys.profile });
        else invalidateFinancial(qc);
      }, 250);
    };

    const channel = supabase.channel(`sync:${userId}`);
    for (const table of ['transactions', 'accounts', 'categories']) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` },
        () => schedule(table),
      );
    }
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, () =>
      schedule('profiles'),
    );
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setChannelState('live');
        // Ao (re)conectar, garante que nada foi perdido durante a desconexão.
        qc.invalidateQueries();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setChannelState('error');
      else if (status === 'CLOSED') setChannelState('connecting');
    });

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [qc, userId]);

  const state: SyncState = !online ? 'offline' : channelState;
  return (
    <SyncContext.Provider value={{ state, busy: fetching + mutating > 0, online, lastEventAt }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  return useContext(SyncContext);
}
