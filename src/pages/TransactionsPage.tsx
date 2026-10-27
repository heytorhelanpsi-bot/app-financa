import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState, Money, PageHeader, QueryError, Spinner } from '@/components/ui';
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
  const status = (params.get('status') as StatusFilter) || 'all';
  const type = (params.get('type') as TypeFilter) || 'all';
  const accountId = params.get('conta');
  const categoryId = params.get('categoria');
  const showArchived = params.get('arquivados') === '1';
  const { openNew } = useTxActions();

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
            <button className="btn-secondary" onClick={() => exportTransactionsCsv(rows, accounts, categories, `movimentacoes-${month.slice(0, 7)}`)} disabled={!rows.length}>
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

      <div className="card mb-4 space-y-3">
        {status !== 'overdue' && (
          <div className="flex items-center justify-between">
            <button className="btn-ghost px-2" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mês anterior">
              <IconLeft />
            </button>
            <span className="text-sm font-semibold">{formatMonth(month)}</span>
            <button className="btn-ghost px-2" onClick={() => setMonth(addMonths(month, 1))} aria-label="Próximo mês">
              <IconRight />
            </button>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="relative lg:col-span-2">
            <span className="sr-only">Buscar</span>
            <IconSearch className="pointer-events-none absolute left-3 top-2.5 text-muted" width={16} height={16} />
            <input className="input pl-9" placeholder="Buscar descrição" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select className="input" aria-label="Situação" value={status} onChange={(e) => setParam('status', e.target.value === 'all' ? null : e.target.value)}>
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
          <select className="input lg:col-span-2" aria-label="Categoria" value={categoryId ?? ''} onChange={(e) => setParam('categoria', e.target.value || null)}>
            <option value="">Todas as categorias</option>
            {buildCategoryOptions(categories, null, categoryId ?? undefined).map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setParam('arquivados', e.target.checked ? '1' : null)} />
            Mostrar arquivados
          </label>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-sm">
          <span>
            <span className="text-muted">Receitas: </span>
            <Money cents={totals.income} className="font-semibold text-income" />
          </span>
          <span>
            <span className="text-muted">Despesas: </span>
            <Money cents={totals.expense} className="font-semibold text-expense" />
          </span>
          <span className="text-xs text-muted">Transferências e ajustes não entram nesses totais.</span>
        </div>
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
