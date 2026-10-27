import { useMemo } from 'react';
import { Badge, Money } from '@/components/ui';
import { formatDayHeader } from '@/lib/dates';
import { STATUS_LABEL, amountColor, displayStatus, isOpen, type DisplayStatus } from '@/lib/labels';
import type { Account, Category, Transaction } from '@/lib/types';
import { useTxActions } from './TxActions';

export function StatusBadge({ status, reversed }: { status: DisplayStatus; reversed?: boolean }) {
  if (reversed) return <Badge>Estornado</Badge>;
  const tone =
    status === 'overdue'
      ? 'danger'
      : status === 'paid' || status === 'received'
        ? 'ok'
        : status === 'pending'
          ? 'warn'
          : status === 'forecast'
            ? 'soft-warn'
            : 'neutral';
  return <Badge tone={tone}>{STATUS_LABEL[status]}</Badge>;
}

export function TransactionRow({
  tx,
  today,
  account,
  category,
  showDate,
}: {
  tx: Transaction;
  today: string;
  account?: Account;
  category?: Category;
  showDate?: boolean;
}) {
  const { openDetails, openSettle } = useTxActions();
  const status = displayStatus(tx, today);
  const signed = tx.direction === 'out' ? -(tx.settled_amount_cents ?? tx.amount_cents) : tx.settled_amount_cents ?? tx.amount_cents;
  const canSettle = isOpen(tx) && (tx.transaction_type === 'income' || tx.transaction_type === 'expense');

  return (
    <li className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2/60">
      <span
        className="h-8 w-1 shrink-0 rounded-full"
        style={{ background: category?.color ?? 'rgb(var(--line))' }}
        aria-hidden
      />
      <button className="min-w-0 flex-1 text-left" onClick={() => openDetails(tx)}>
        <span className={`block truncate text-sm font-medium ${tx.reversed_at || tx.status === 'canceled' ? 'text-muted line-through' : ''}`}>
          {tx.description}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          {showDate && <span>{formatDayHeader(tx.ref_date, today)}</span>}
          {category && <span>{category.name}</span>}
          {account && <span>· {account.name}</span>}
          {tx.transaction_type === 'reversal' ? <Badge>Estorno</Badge> : <StatusBadge status={status} reversed={!!tx.reversed_at} />}
          {tx.archived_at && <Badge>Arquivado</Badge>}
        </span>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Money cents={signed} signed className={`text-sm font-semibold ${amountColor(tx)}`} />
        {canSettle && (
          <button className="text-xs font-semibold text-accent" onClick={() => openSettle(tx)}>
            {tx.direction === 'out' ? 'Pagar' : 'Receber'}
          </button>
        )}
      </div>
    </li>
  );
}

export function GroupedTransactionList({
  transactions,
  today,
  accounts,
  categories,
}: {
  transactions: Transaction[];
  today: string;
  accounts: Account[];
  categories: Category[];
}) {
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const t of transactions) {
      const list = m.get(t.ref_date) ?? [];
      list.push(t);
      m.set(t.ref_date, list);
    }
    return [...m.entries()];
  }, [transactions]);

  return (
    <div className="space-y-3">
      {groups.map(([date, items]) => (
        <section key={date} className="overflow-hidden rounded-xl border border-line bg-surface">
          <h3 className="border-b border-line bg-surface-2/50 px-3 py-1.5 text-xs font-semibold text-muted">
            {formatDayHeader(date, today)}
          </h3>
          <ul className="divide-y divide-line/60">
            {items.map((t) => (
              <TransactionRow
                key={t.id}
                tx={t}
                today={today}
                account={t.account_id ? accountMap.get(t.account_id) : undefined}
                category={t.category_id ? categoryMap.get(t.category_id) : undefined}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
