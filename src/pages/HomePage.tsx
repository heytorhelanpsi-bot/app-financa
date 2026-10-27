import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, Money, QueryError, Spinner, Toggle } from '@/components/ui';
import { IconAlert } from '@/components/icons';
import { useAccounts, useCategories, useOpenTransactions, useProfile, useSummary } from '@/hooks/data';
import { useToday } from '@/hooks/useToday';
import { formatDate, formatDayHeader, formatPeriod, isValidISODate, periodFor, type PeriodKind } from '@/lib/dates';
import type { Account, Category, Transaction } from '@/lib/types';
import { TransactionRow } from '@/features/transactions/TransactionList';
import { useTxActions } from '@/features/transactions/TxActions';

const PERIODS: [PeriodKind, string, string][] = [
  ['week', 'Semana', 'Semana'],
  ['month', 'Mês atual', 'Mês'],
  ['next_month', 'Próximo mês', 'Próximo'],
  ['custom', 'Personalizado', 'Período'],
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
  const firstName = useProfile().data?.display_name?.split(' ')[0];

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

  const bank = Number(s.bank_balance_cents);
  const committed = Number(s.committed_cents);
  const free = Number(s.free_cents);
  // Barra de comprometimento: quanto do saldo já tem destino.
  const committedPct = bank > 0 ? Math.min(100, Math.round((committed / bank) * 100)) : committed > 0 ? 100 : 0;

  return (
    <div className="stagger space-y-8">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{formatDayHeader(today, today)} · {formatDate(today)}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
            {firstName ? `Olá, ${firstName}` : 'Visão geral'}
          </h1>
        </div>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          <div className="segmented grid w-full grid-cols-4 sm:inline-flex sm:w-auto" role="group" aria-label="Período">
            {PERIODS.map(([k, label, short]) => (
              <button key={k} className={`chip justify-center ${kind === k ? 'chip-active' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
          {kind === 'custom' ? (
            <span className="flex items-center gap-2 text-xs text-muted">
              <input type="date" aria-label="Início" className="input h-9 w-auto" value={custom.start} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))} />
              até
              <input type="date" aria-label="Fim" className="input h-9 w-auto" value={custom.end} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))} />
            </span>
          ) : (
            <span className="text-xs text-muted">{formatPeriod(period)}</span>
          )}
        </div>
      </div>

      {noAccounts && (
        <div className="card flex flex-wrap items-center justify-between gap-4 border-accent/40">
          <div className="max-w-xl">
            <p className="font-semibold">Comece cadastrando suas contas</p>
            <p className="mt-1 text-sm text-muted">
              Informe o saldo atual de cada conta, carteira ou benefício. A partir daí, tudo é calculado pelas movimentações.
            </p>
          </div>
          <Link to="/contas" className="btn-primary">
            Cadastrar conta
          </Link>
        </div>
      )}

      {/* Saldo em destaque */}
      <section className="hero" aria-label="Saldos">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="eyebrow">Saldo bancário atual</p>
            <div data-testid="saldo-bancario">
              <Money
                cents={bank}
                className={`mt-2 block text-[2.6rem] font-semibold leading-none tracking-tight md:text-6xl ${bank < 0 ? 'text-expense glow-expense' : ''}`}
              />
            </div>
            <p className="mt-3 text-sm text-muted">Dinheiro efetivamente nas suas contas</p>
          </div>
          <div className="text-left sm:text-right">
            <p className="eyebrow">Livre para gastar</p>
            <Money
              cents={free}
              className={`mt-2 block text-3xl font-semibold tracking-tight md:text-4xl ${free < 0 ? 'text-expense glow-expense' : 'text-income glow-income'}`}
            />
            <p className="mt-2 text-xs text-muted">
              {s.considered_income_cents > 0 ? (
                <>
                  inclui <Money cents={s.considered_income_cents} /> a receber
                </>
              ) : (
                'sem contar o que ainda não entrou'
              )}
            </p>
          </div>
        </div>

        {/* Barra de comprometimento */}
        <div className="mt-8">
          <div
            className="flex h-2.5 overflow-hidden rounded-full bg-white/10"
            role="img"
            aria-label={`${committedPct}% do saldo já comprometido`}
          >
            <div className="bar-expense h-full rounded-full transition-all duration-700" style={{ width: `${committedPct}%` }} />
            <div className="bar-income ml-1 h-full flex-1 rounded-full" style={{ opacity: free > 0 ? 1 : 0 }} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="dot bg-expense glow-dot-expense" />
              <span className="text-muted">Comprometido</span>
              <Money cents={committed} className="font-semibold text-expense" />
            </span>
            <span className="flex items-center gap-2">
              <span className="dot bg-income glow-dot-income" />
              <span className="text-muted">Livre</span>
              <Money cents={Math.max(0, free)} className="font-semibold text-income" />
            </span>
            <span className="text-xs text-muted">
              Contas em aberto até {formatDate(period.end)}
              {forecastExpenses ? ', incluindo previstas' : ', apenas pendentes'}
            </span>
          </div>
          {free < 0 && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-expense/15 px-3 py-1 text-xs font-semibold text-expense">
              <IconAlert width={14} height={14} /> Atenção: as obrigações superam o saldo em <Money cents={-free} />
            </p>
          )}
        </div>

        <div className="mt-6 grid gap-4 border-t border-white/10 pt-5 text-sm sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <p className="eyebrow">Projetado em {formatDate(period.end)}</p>
              <Money cents={s.projected_end_cents} className={`mt-1 block text-lg font-semibold ${s.projected_end_cents < 0 ? 'text-expense' : ''}`} />
              {s.projection_uncertain_income_cents > 0 && (
                <p className="text-xs text-income-forecast">
                  depende de <Money cents={s.projection_uncertain_income_cents} /> previstos
                </p>
              )}
            </div>
            {s.benefit_balance_cents !== 0 && (
              <div>
                <p className="eyebrow">Benefícios</p>
                <Money cents={s.benefit_balance_cents} className="mt-1 block text-lg font-semibold text-muted" />
                <p className="text-xs text-muted">uso restrito, fora do saldo livre</p>
              </div>
            )}
          </div>
          <button className="pill-action justify-self-start sm:justify-self-end" onClick={() => setShowScenario((v) => !v)} aria-expanded={showScenario}>
            {showScenario ? 'Fechar cenário' : 'Ajustar cenário'}
          </button>
        </div>

        {showScenario && (
          <div className="mt-4 grid gap-2 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-3">
            <Toggle checked={forecastExpenses} onChange={setForecastExpenses} label="Descontar despesas previstas" />
            <Toggle checked={pendingIncome} onChange={setPendingIncome} label="Somar receitas pendentes" description="Confirmadas, ainda não recebidas" />
            <Toggle checked={forecastIncome} onChange={setForecastIncome} label="Somar receitas previstas" description="Ainda incertas" />
          </div>
        )}
      </section>

      {/* Despesas x Receitas */}
      <div className="grid gap-4 md:grid-cols-2">
        <FlowCard
          title="Despesas"
          tone="expense"
          mainLabel="Pagas no período"
          main={s.expenses.paid_cents}
          rows={[
            ['Registradas e pendentes', s.expenses.pending_cents, 'text-expense', 'bg-expense'],
            ['Previstas', s.expenses.forecast_cents, 'text-expense-forecast', 'bg-expense-forecast'],
          ]}
          alert={
            s.expenses.overdue_count > 0 && (
              <Link
                to="/movimentacoes?status=overdue"
                className="mt-4 flex items-center justify-between rounded-xl border border-expense/40 bg-expense/10 px-3.5 py-2.5 text-sm transition hover:bg-expense/15"
              >
                <span className="flex items-center gap-2 font-semibold text-expense">
                  <IconAlert width={16} height={16} /> {s.expenses.overdue_count} {s.expenses.overdue_count === 1 ? 'conta vencida' : 'contas vencidas'}
                </span>
                <Money cents={s.expenses.overdue_cents} className="font-semibold text-expense" />
              </Link>
            )
          }
        />
        <FlowCard
          title="Receitas"
          tone="income"
          mainLabel="Recebidas no período"
          main={s.income.received_cents}
          rows={[
            ['Esperadas, não confirmadas', s.income.pending_cents, 'text-income-forecast', 'bg-income-forecast'],
            ['Previstas', s.income.forecast_cents, 'text-income-forecast', 'bg-income-forecast/60'],
          ]}
          alert={
            s.income.late_count > 0 && (
              <p className="mt-4 rounded-xl border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-xs">
                <strong className="text-warn">Atenção:</strong> {s.income.late_count} recebimento(s) com data passada ainda não
                confirmado(s) — <Money cents={s.income.late_cents} />.
              </p>
            )
          }
        />
      </div>

      {/* Próximos compromissos */}
      <div className="grid gap-6 md:grid-cols-2">
        <UpcomingList
          title="A pagar"
          until={period.end}
          empty="Nenhuma conta em aberto no período."
          action={<button className="link" onClick={() => openNew('expense')}>+ Despesa</button>}
          items={upcomingExpenses}
          today={today}
          accountMap={accountMap}
          categoryMap={categoryMap}
        />
        <UpcomingList
          title="A receber"
          until={period.end}
          empty="Nenhum recebimento em aberto no período."
          action={<button className="link" onClick={() => openNew('income')}>+ Receita</button>}
          items={upcomingIncome}
          today={today}
          accountMap={accountMap}
          categoryMap={categoryMap}
        />
      </div>
    </div>
  );
}

function FlowCard({
  title,
  tone,
  mainLabel,
  main,
  rows,
  alert,
}: {
  title: string;
  tone: 'income' | 'expense';
  mainLabel: string;
  main: number;
  rows: [string, number, string, string][];
  alert?: React.ReactNode;
}) {
  const color = tone === 'income' ? 'text-income glow-income' : 'text-expense glow-expense';
  const tint = tone === 'income' ? 'rgb(var(--income))' : 'rgb(var(--expense))';
  return (
    <section className="card" aria-label={`${title} do período`}>
      <div className="flex items-center gap-3">
        <span className="icon-bubble h-10 w-10" style={{ color: tint, background: `color-mix(in srgb, ${tint} 14%, transparent)` }} aria-hidden>
          {tone === 'income' ? '↙' : '↗'}
        </span>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      </div>
      <p className="eyebrow mt-4">{mainLabel}</p>
      <Money cents={main} className={`mt-1 block text-2xl font-semibold tracking-tight ${color}`} />
      <dl className="mt-4 space-y-2.5 border-t border-line/70 pt-4 text-sm">
        {rows.map(([label, cents, cls, dotCls]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-2 text-muted">
              <span className={`dot h-1.5 w-1.5 ${dotCls}`} />
              {label}
            </dt>
            <dd>
              <Money cents={cents} className={`font-medium ${cls}`} />
            </dd>
          </div>
        ))}
      </dl>
      {alert}
    </section>
  );
}

function UpcomingList({
  title,
  until,
  empty,
  action,
  items,
  today,
  accountMap,
  categoryMap,
}: {
  title: string;
  until: string;
  empty: string;
  action: React.ReactNode;
  items: Transaction[];
  today: string;
  accountMap: Map<string, Account>;
  categoryMap: Map<string, Category>;
}) {
  return (
    <section aria-label={`${title} até ${formatDate(until)}`}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold tracking-tight">
          {title} <span className="text-sm font-normal text-muted">até {formatDate(until)}</span>
        </h2>
        {action}
      </div>
      {items.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="card-flat divide-y divide-line/60 overflow-hidden">
          {items.slice(0, 12).map((t) => (
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
  );
}
