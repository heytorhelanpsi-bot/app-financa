import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState, Money, PageHeader, QueryError, Spinner, Toggle } from '@/components/ui';
import { IconLeft, IconRight, IconSearch } from '@/components/icons';
import {
  TX_LIMIT,
  useAccounts,
  useCategories,
  useTransactions,
  type StatusFilter,
  type TypeFilter,
} from '@/hooks/data';
import { useToday } from '@/hooks/useToday';
import { addMonths, endOfMonth, formatMonth, startOfMonth } from '@/lib/dates';
import { GroupedTransactionList } from '@/features/transactions/TransactionList';
import { useTxActions } from '@/features/transactions/TxActions';
import { buildCategoryOptions } from '@/features/transactions/TransactionForm';
import { exportTransactionsCsv } from '@/features/export';

const STATUS_OPTIONS: [StatusFilter, string][] = [
  ['all', 'Todos'],
  ['open', 'Em aberto'],
  ['overdue', 'Vencidos'],
  ['pending', 'Pendentes'],
  ['forecast', 'Previstos'],
  ['settled', 'Pagos/recebidos'],
  ['canceled', 'Cancelados'],
];

const QUICK_STATUS: [StatusFilter, string][] = [
  ['all', 'Todos'],
  ['open', 'Em aberto'],
  ['overdue', 'Vencidos'],
  ['settled', 'Efetivados'],
];

const TYPE_OPTIONS: [TypeFilter, string][] = [
  ['all', 'Todos os tipos'],
  ['expense', 'Despesas'],
  ['income', 'Receitas'],
  ['transfer', 'Transferências'],
  ['other', 'Ajustes e estornos'],
];

export function TransactionsPage() {
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const status = (params.get('status') as StatusFilter) || 'all';
  const type = (params.get('type') as TypeFilter) || 'all';
  const accountId = params.get('conta');
  const categoryId = params.get('categoria');
  const showArchived = params.get('arquivados') === '1';
  const { openNew } = useTxActions();
  const activeFilters = [type !== 'all', !!accountId, !!categoryId, showArchived].filter(Boolean).length;

  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];

  const categoryIds = useMemo(() => {
    if (!categoryId) return null;
    return [categoryId, ...categories.filter((c) => c.parent_id === categoryId).map((c) => c.id)];
  }, [categoryId, categories]);

  const filters = {
    start: month,
    end: endOfMonth(month),
    today,
    type,
    status,
    accountId,
    categoryIds,
    search,
    showArchived,
  };
  const query = useTransactions(filters);
  const rows = query.data ?? [];

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of rows) {
      if (t.status === 'canceled' || t.reversed_at) continue;
      if (t.transaction_type === 'income') income += t.settled_amount_cents ?? t.amount_cents;
      if (t.transaction_type === 'expense') expense += t.settled_amount_cents ?? t.amount_cents;
    }
    return { income, expense };
  }, [rows]);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Movimentações"
        actions={
          <>
            <button className="btn-ghost" onClick={() => exportTransactionsCsv(rows, accounts, categories, `movimentacoes-${month.slice(0, 7)}`)} disabled={!rows.length}>
              Exportar CSV
            </button>
            <button className="btn-secondary" onClick={() => openNew('income')}>
              + Receita
            </button>
            <button className="btn-primary" onClick={() => openNew('expense')}>
              + Despesa
            </button>
          </>
        }
      />

      {/* Mês e totais */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        {status !== 'overdue' ? (
          <div className="glass inline-flex items-center gap-1 rounded-full p-1">
            <button className="btn-ghost h-8 w-8 px-0" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mês anterior">
              <IconLeft width={18} height={18} />
            </button>
            <span className="min-w-[10rem] text-center text-sm font-semibold">{formatMonth(month)}</span>
            <button className="btn-ghost h-8 w-8 px-0" onClick={() => setMonth(addMonths(month, 1))} aria-label="Próximo mês">
              <IconRight width={18} height={18} />
            </button>
          </div>
        ) : (
          <span className="text-sm font-semibold text-expense">Todos os lançamentos vencidos</span>
        )}
        <div className="flex gap-2 text-sm">
          <span className="glass flex items-center gap-2 rounded-full px-4 py-2">
            <span className="dot bg-income glow-dot-income" />
            <Money cents={totals.income} className="font-semibold text-income" />
          </span>
          <span className="glass flex items-center gap-2 rounded-full px-4 py-2">
            <span className="dot bg-expense glow-dot-expense" />
            <Money cents={totals.expense} className="font-semibold text-expense" />
          </span>
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[200px] flex-1">
            <span className="sr-only">Buscar</span>
            <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" width={16} height={16} />
            <input className="input pl-10" placeholder="Buscar descrição" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="segmented" role="group" aria-label="Situação">
            {QUICK_STATUS.map(([v, l]) => (
              <button
                key={v}
                className={`chip ${status === v ? 'chip-active' : ''}`}
                aria-pressed={status === v}
                onClick={() => setParam('status', v === 'all' ? null : v)}
              >
                {l}
              </button>
            ))}
          </div>
          <button
            className={`btn-secondary ${activeFilters ? 'border-accent/60 text-accent' : ''}`}
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
          >
            Filtros{activeFilters ? ` (${activeFilters})` : ''}
          </button>
        </div>
        {showFilters && (
          <div className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <select className="input" aria-label="Situação detalhada" value={status} onChange={(e) => setParam('status', e.target.value === 'all' ? null : e.target.value)}>
              {STATUS_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <select className="input" aria-label="Tipo" value={type} onChange={(e) => setParam('type', e.target.value === 'all' ? null : e.target.value)}>
              {TYPE_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <select className="input" aria-label="Conta" value={accountId ?? ''} onChange={(e) => setParam('conta', e.target.value || null)}>
              <option value="">Todas as contas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <select className="input" aria-label="Categoria" value={categoryId ?? ''} onChange={(e) => setParam('categoria', e.target.value || null)}>
              <option value="">Todas as categorias</option>
              {buildCategoryOptions(categories, null, categoryId ?? undefined).map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <div className="sm:col-span-2 lg:col-span-4">
              <Toggle checked={showArchived} onChange={(v) => setParam('arquivados', v ? '1' : null)} label="Mostrar arquivados" />
            </div>
          </div>
        )}
        <p className="text-xs text-muted">Totais consideram receitas e despesas; transferências e ajustes ficam de fora.</p>
      </div>

      {query.isLoading ? (
        <Spinner />
      ) : query.error ? (
        <QueryError error={query.error} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nenhum lançamento encontrado.">Ajuste os filtros ou registre um novo lançamento.</EmptyState>
      ) : (
        <>
          <GroupedTransactionList transactions={rows} today={today} accounts={accounts} categories={categories} />
          {rows.length >= TX_LIMIT && (
            <p className="mt-3 text-center text-xs text-muted">Exibindo os {TX_LIMIT} mais recentes. Refine os filtros.</p>
          )}
        </>
      )}
    </div>
  );
}
