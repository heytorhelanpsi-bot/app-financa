import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Aceita a URL do projeto mesmo que tenha sido copiada com caminho
 * (ex.: "https://xxx.supabase.co/rest/v1/") ou com espaços: usa só a origem.
 */
export function normalizeSupabaseUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

const url = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const isSupabaseConfigured = Boolean(url && anonKey);

// Somente a chave pública (anon) vai para o navegador. A segurança dos dados
// é garantida pelas políticas RLS e pelas funções do banco.
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : (null as unknown as SupabaseClient);
