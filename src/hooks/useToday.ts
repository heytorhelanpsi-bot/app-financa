import { useEffect, useState } from 'react';
import { todayIn } from '@/lib/dates';
import { useProfile } from './data';

/** Data de hoje no fuso do perfil; atualiza ao virar o dia. */
export function useToday(): string {
  const tz = useProfile().data?.timezone ?? 'America/Sao_Paulo';
  const [today, setToday] = useState(() => todayIn(tz));
  useEffect(() => {
    setToday(todayIn(tz));
    const id = setInterval(() => setToday(todayIn(tz)), 60_000);
    return () => clearInterval(id);
  }, [tz]);
  return today;
}
