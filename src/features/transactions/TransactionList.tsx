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

  const muted = !!tx.reversed_at || tx.status === 'canceled';
  const isSystem = tx.transaction_type !== 'income' && tx.transaction_type !== 'expense';
  const tint = category?.color ?? (isSystem ? 'rgb(var(--muted))' : tx.direction === 'out' ? 'rgb(var(--expense))' : 'rgb(var(--income))');
  const glyph = tx.transaction_type === 'transfer' ? '⇄' : tx.transaction_type === 'reversal' ? '↺' : tx.transaction_type === 'adjustment' ? '±' : tx.direction === 'out' ? '↑' : '↓';

  return (
    <li className="group flex items-center gap-3.5 px-4 py-3.5 transition hover:bg-accent/5">
      <span
        className="icon-bubble"
        style={{ color: tint, background: `color-mix(in srgb, ${tint} 14%, transparent)` }}
        aria-hidden
      >
        {glyph}
      </span>
      <button className="min-w-0 flex-1 text-left" onClick={() => openDetails(tx)}>
        <span className={`block truncate text-sm font-medium ${muted ? 'text-muted line-through' : ''}`}>{tx.description}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
          {showDate && <span>{formatDayHeader(tx.ref_date, today)}</span>}
          {showDate && (category || account) && <span aria-hidden>·</span>}
          {category && <span>{category.name}</span>}
          {category && account && <span aria-hidden>·</span>}
          {account && <span>{account.name}</span>}
          <span className="ml-0.5">
            {tx.transaction_type === 'reversal' ? <Badge>Estorno</Badge> : <StatusBadge status={status} reversed={!!tx.reversed_at} />}
          </span>
          {tx.archived_at && <Badge>Arquivado</Badge>}
        </span>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Money cents={signed} signed className={`text-sm font-semibold ${tx.reversed_at ? 'text-muted line-through' : amountColor(tx)}`} />
        {canSettle && (
          <button className="pill-action" onClick={() => openSettle(tx)}>
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
    <div className="space-y-6">
      {groups.map(([date, items]) => (
        <section key={date}>
          <h3 className="eyebrow mb-2 px-1">{formatDayHeader(date, today)}</h3>
          <ul className="card-flat divide-y divide-fg/5 overflow-hidden">
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
