import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, Money, QueryError, Spinner, Toggle } from '@/components/ui';
import { IconAlert } from '@/components/icons';
import { useAccounts, useCategories, useOpenTransactions, useSummary } from '@/hooks/data';
import { useToday } from '@/hooks/useToday';
import { formatDate, formatPeriod, isValidISODate, periodFor, type PeriodKind } from '@/lib/dates';
import { TransactionRow } from '@/features/transactions/TransactionList';
import { useTxActions } from '@/features/transactions/TxActions';

const PERIODS: [PeriodKind, string][] = [
  ['week', 'Semana'],
  ['month', 'Mês atual'],
  ['next_month', 'Próximo mês'],
  ['custom', 'Personalizado'],
];

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem('home-prefs') ?? '{}') as Partial<{
      kind: PeriodKind;
      forecastExpenses: boolean;
      pendingIncome: boolean;
      forecastIncome: boolean;
    }>;
  } catch {
    return {};
  }
}

export function HomePage() {
  const today = useToday();
  const prefs = useMemo(loadPrefs, []);
  const [kind, setKind] = useState<PeriodKind>(prefs.kind ?? 'month');
  const [custom, setCustom] = useState({ start: today, end: today });
  const [forecastExpenses, setForecastExpenses] = useState(prefs.forecastExpenses ?? true);
  const [pendingIncome, setPendingIncome] = useState(prefs.pendingIncome ?? false);
  const [forecastIncome, setForecastIncome] = useState(prefs.forecastIncome ?? false);
  const [showScenario, setShowScenario] = useState(false);
  const { openNew } = useTxActions();

  useEffect(() => {
    try {
      localStorage.setItem('home-prefs', JSON.stringify({ kind, forecastExpenses, pendingIncome, forecastIncome }));
    } catch {
      /* preferências locais são opcionais */
    }
  }, [kind, forecastExpenses, pendingIncome, forecastIncome]);

  const customValid = isValidISODate(custom.start) && isValidISODate(custom.end);
  const period = periodFor(kind, today, customValid ? custom : undefined);
  const summary = useSummary({
    start: period.start,
    end: period.end,
    includeForecastExpenses: forecastExpenses,
    includePendingIncome: pendingIncome,
    includeForecastIncome: forecastIncome,
  });
  const accounts = useAccounts();
  const categories = useCategories().data ?? [];
  const upcoming = useOpenTransactions(period.end);

  if (accounts.isLoading || summary.isLoading) return <Spinner />;
  if (summary.error) return <QueryError error={summary.error} onRetry={() => summary.refetch()} />;
  const s = summary.data!;
  const noAccounts = (accounts.data ?? []).length === 0;
  const upcomingExpenses = (upcoming.data ?? []).filter((t) => t.direction === 'out');
  const upcomingIncome = (upcoming.data ?? []).filter((t) => t.direction === 'in');
  const accountMap = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  return (
    <div className="space-y-5">
      {noAccounts && (
        <div className="card border-accent/50">
          <p className="font-semibold">Comece cadastrando suas contas</p>
          <p className="mt-1 text-sm text-muted">
            Informe o saldo atual de cada conta bancária, carteira ou benefício. A partir daí, todos os saldos são calculados
            pelas movimentações.
          </p>
          <Link to="/contas" className="btn-primary mt-3">
            Cadastrar conta
          </Link>
        </div>
      )}

      {/* Período */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Período">
        {PERIODS.map(([k, label]) => (
          <button key={k} className={`chip ${kind === k ? 'chip-active' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
        {kind === 'custom' && (
          <span className="flex items-center gap-2 text-sm">
            <input type="date" aria-label="Início" className="input w-auto py-1" value={custom.start} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))} />
            a
            <input type="date" aria-label="Fim" className="input w-auto py-1" value={custom.end} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))} />
          </span>
        )}
        <span className="ml-auto text-xs text-muted">{formatPeriod(period)}</span>
      </div>

      {/* Indicadores principais */}
      <section className="card p-5" aria-label="Saldos">
        <div className="grid gap-5 md:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Saldo bancário atual</p>
            <Money cents={s.bank_balance_cents} className={`block text-3xl font-bold md:text-4xl ${s.bank_balance_cents < 0 ? 'text-expense' : ''}`} />
            <p className="mt-1 text-xs text-muted">Dinheiro efetivamente nas contas</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Comprometido</p>
            <Money cents={-s.committed_cents} className="block text-2xl font-bold text-expense" />
            <p className="mt-1 text-xs text-muted">
              Contas em aberto até {formatDate(period.end)}
              {forecastExpenses ? ', incluindo previstas' : ', só pendentes'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Livre para gastar</p>
            <Money cents={s.free_cents} className={`block text-2xl font-bold ${s.free_cents < 0 ? 'text-expense' : 'text-income'}`} />
            <p className="mt-1 text-xs text-muted">
              {s.considered_income_cents > 0 ? (
                <>
                  Considera <Money cents={s.considered_income_cents} /> a receber
                </>
              ) : (
                'Sem contar receitas ainda não recebidas'
              )}
            </p>
            {s.free_cents < 0 && (
              <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-expense">
                <IconAlert width={14} height={14} /> Atenção: obrigações maiores que o saldo
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm">
          <p>
            <span className="text-muted">Saldo projetado em {formatDate(period.end)}: </span>
            <Money cents={s.projected_end_cents} className={`font-semibold ${s.projected_end_cents < 0 ? 'text-expense' : ''}`} />
            {s.projection_uncertain_income_cents > 0 && (
              <span className="block text-xs text-income-forecast">
                Depende de <Money cents={s.projection_uncertain_income_cents} /> em receitas previstas (incertas)
              </span>
            )}
          </p>
          {s.benefit_balance_cents !== 0 && (
            <p className="text-xs text-muted">
              Benefícios de uso restrito: <Money cents={s.benefit_balance_cents} /> (fora do saldo livre)
            </p>
          )}
          <button className="text-xs font-medium text-accent" onClick={() => setShowScenario((v) => !v)} aria-expanded={showScenario}>
            {showScenario ? 'Fechar cenário' : 'Ajustar cenário'}
          </button>
        </div>

        {showScenario && (
          <div className="mt-3 grid gap-1 rounded-lg bg-surface-2 p-3 sm:grid-cols-3">
            <Toggle checked={forecastExpenses} onChange={setForecastExpenses} label="Descontar despesas previstas" />
            <Toggle checked={pendingIncome} onChange={setPendingIncome} label="Somar receitas pendentes" description="Confirmadas, ainda não recebidas" />
            <Toggle checked={forecastIncome} onChange={setForecastIncome} label="Somar receitas previstas" description="Incertas" />
          </div>
        )}
      </section>

      {/* Despesas x Receitas */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card" aria-label="Despesas do período">
          <h2 className="mb-3 text-sm font-semibold">Despesas</h2>
          <dl className="space-y-2 text-sm">
            <Line label="Pagas no período" cents={s.expenses.paid_cents} className="text-expense font-semibold" />
            <Line label="Registradas e pendentes" cents={s.expenses.pending_cents} className="text-expense" />
            <Line label="Previstas" cents={s.expenses.forecast_cents} className="text-xs text-expense-forecast" small />
          </dl>
          {s.expenses.overdue_count > 0 && (
            <Link
              to="/movimentacoes?status=overdue"
              className="mt-3 flex items-center justify-between rounded-lg border border-expense/50 bg-expense/10 px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2 font-semibold text-expense">
                <IconAlert width={16} height={16} /> {s.expenses.overdue_count} conta(s) vencida(s)
              </span>
              <Money cents={s.expenses.overdue_cents} className="font-semibold text-expense" />
            </Link>
          )}
        </section>
        <section className="card" aria-label="Receitas do período">
          <h2 className="mb-3 text-sm font-semibold">Receitas</h2>
          <dl className="space-y-2 text-sm">
            <Line label="Recebidas no período" cents={s.income.received_cents} className="text-income font-semibold" />
            <Line label="Esperadas, não confirmadas" cents={s.income.pending_cents} className="text-income-forecast" />
            <Line label="Previstas" cents={s.income.forecast_cents} className="text-xs text-income-forecast" small />
          </dl>
          {s.income.late_count > 0 && (
            <p className="mt-3 rounded-lg border border-warn/40 px-3 py-2 text-xs">
              <strong className="text-warn">Atenção:</strong> {s.income.late_count} recebimento(s) com data passada ainda não
              confirmado(s) (<Money cents={s.income.late_cents} />).
            </p>
          )}
        </section>
      </div>

      {/* Próximos compromissos */}
      <div className="grid gap-4 md:grid-cols-2">
        <section aria-label="Contas a pagar">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">A pagar até {formatDate(period.end)}</h2>
            <button className="text-xs font-semibold text-accent" onClick={() => openNew('expense')}>
              + Despesa
            </button>
          </div>
          {upcomingExpenses.length === 0 ? (
            <EmptyState title="Nenhuma conta em aberto no período." />
          ) : (
            <ul className="divide-y divide-line/60 overflow-hidden rounded-xl border border-line bg-surface">
              {upcomingExpenses.slice(0, 12).map((t) => (
                <TransactionRow
                  key={t.id}
                  tx={t}
                  today={today}
                  showDate
                  account={t.account_id ? accountMap.get(t.account_id) : undefined}
                  category={t.category_id ? categoryMap.get(t.category_id) : undefined}
                />
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Valores a receber">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">A receber até {formatDate(period.end)}</h2>
            <button className="text-xs font-semibold text-accent" onClick={() => openNew('income')}>
              + Receita
            </button>
          </div>
          {upcomingIncome.length === 0 ? (
            <EmptyState title="Nenhum recebimento em aberto no período." />
          ) : (
            <ul className="divide-y divide-line/60 overflow-hidden rounded-xl border border-line bg-surface">
              {upcomingIncome.slice(0, 12).map((t) => (
                <TransactionRow
                  key={t.id}
                  tx={t}
                  today={today}
                  showDate
                  account={t.account_id ? accountMap.get(t.account_id) : undefined}
                  category={t.category_id ? categoryMap.get(t.category_id) : undefined}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Line({ label, cents, className, small }: { label: string; cents: number; className?: string; small?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${small ? 'text-xs' : ''}`}>
      <dt className="text-muted">{label}</dt>
      <dd>
        <Money cents={cents} className={className} />
      </dd>
    </div>
  );
}
