import { useEffect, useState } from 'react';
import { Field, FormError, PageHeader, Spinner, useToast } from '@/components/ui';
import { useAccounts, useCategories, useProfile, useUpdateProfile } from '@/hooks/data';
import { applyTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import type { Theme, Transaction } from '@/lib/types';
import { CategoryManager } from '@/features/categories/CategoryManager';
import { exportAllData, exportTransactionsCsv } from '@/features/export';

const TIMEZONES = [
  'America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza',
  'America/Recife', 'America/Bahia', 'America/Rio_Branco', 'America/Noronha', 'UTC',
];

export function SettingsPage() {
  const profile = useProfile();
  const update = useUpdateProfile();
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];
  const toast = useToast();
  const [name, setName] = useState('');
  const [exporting, setExporting] = useState(false);
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwPending, setPwPending] = useState(false);

  useEffect(() => {
    if (profile.data) setName(profile.data.display_name ?? '');
  }, [profile.data?.display_name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (profile.isLoading || !profile.data) return <Spinner />;
  const p = profile.data;

  const saveProfile = (patch: Parameters<typeof update.mutate>[0]['patch'], msg = 'Preferências salvas.') =>
    update.mutate({ profile: p, patch }, { onSuccess: () => toast(msg), onError: (e) => toast(friendlyError(e), 'error') });

  const setTheme = (theme: Theme) => {
    applyTheme(theme);
    saveProfile({ theme });
  };

  async function runExport(kind: 'json' | 'csv') {
    setExporting(true);
    try {
      if (kind === 'json') await exportAllData();
      else {
        const all: Transaction[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.from('transactions').select('*').order('ref_date').range(from, from + 999);
          if (error) throw error;
          all.push(...(data as Transaction[]));
          if (data.length < 1000) break;
        }
        exportTransactionsCsv(all, accounts, categories, `movimentacoes-completo-${new Date().toISOString().slice(0, 10)}`);
      }
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setExporting(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setPwError('A senha deve ter pelo menos 8 caracteres.');
    setPwError(null);
    setPwPending(true);
    const { error } = await supabase.auth.updateUser({ password });
    setPwPending(false);
    if (error) return setPwError(error.message);
    setPassword('');
    toast('Senha alterada.');
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Configurações" />

      <section className="card grid gap-4 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Perfil e aparência</h2>
        <Field label="Nome de exibição" htmlFor="pf-name">
          <div className="flex gap-2">
            <input id="pf-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn-secondary" disabled={update.isPending || name === (p.display_name ?? '')} onClick={() => saveProfile({ display_name: name.trim() || null })}>
              Salvar
            </button>
          </div>
        </Field>
        <Field label="Fuso horário" htmlFor="pf-tz" hint="Define o que é “hoje” e quando uma conta vence.">
          <select id="pf-tz" className="input" value={p.timezone} onChange={(e) => saveProfile({ timezone: e.target.value })}>
            {(TIMEZONES.includes(p.timezone) ? TIMEZONES : [p.timezone, ...TIMEZONES]).map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <span className="label">Tema</span>
          <div className="flex gap-2" role="radiogroup" aria-label="Tema">
            {([['dark', 'Escuro'], ['light', 'Claro'], ['system', 'Do sistema']] as const).map(([t, l]) => (
              <button key={t} role="radio" aria-checked={p.theme === t} className={`chip ${p.theme === t ? 'chip-active' : ''}`} onClick={() => setTheme(t)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted sm:col-span-2">Moeda: {p.currency_code}</p>
      </section>

      <CategoryManager />

      <section className="card space-y-3">
        <h2 className="font-semibold">Seus dados</h2>
        <p className="text-sm text-muted">
          Os dados ficam no banco de dados em nuvem, isolados por usuário, e sincronizam entre seus dispositivos. Você pode
          baixar uma cópia completa a qualquer momento.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={exporting} onClick={() => runExport('json')}>
            {exporting ? 'Exportando…' : 'Backup completo (JSON)'}
          </button>
          <button className="btn-secondary" disabled={exporting} onClick={() => runExport('csv')}>
            Todas as movimentações (CSV)
          </button>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Segurança</h2>
        <form onSubmit={changePassword} className="flex flex-wrap items-end gap-2" noValidate>
          <Field label="Nova senha" htmlFor="pf-pw" className="min-w-[220px] flex-1">
            <input id="pf-pw" type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button className="btn-secondary" disabled={pwPending || !password}>Alterar senha</button>
        </form>
        <FormError message={pwError} />
        <button className="btn-danger" onClick={() => supabase.auth.signOut()}>Sair desta conta</button>
      </section>
    </div>
  );
}
