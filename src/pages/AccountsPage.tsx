import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog, EmptyState, Money, PageHeader, QueryError, Spinner, useToast } from '@/components/ui';
import { IconSwap } from '@/components/icons';
import { useAccounts, useBalances, useDeleteAccount } from '@/hooks/data';
import { friendlyError } from '@/lib/errors';
import { formatDate } from '@/lib/dates';
import { ACCOUNT_TYPE_LABEL } from '@/lib/labels';
import type { Account, AccountBalance } from '@/lib/types';
import { AccountForm, AdjustDialog, TransferDialog } from '@/features/accounts/AccountDialogs';

export function AccountsPage() {
  const accounts = useAccounts();
  const balances = useBalances();
  const del = useDeleteAccount();
  const toast = useToast();
  const [editing, setEditing] = useState<{ open: boolean; account?: Account }>({ open: false });
  const [transferFrom, setTransferFrom] = useState<string | null | undefined>(undefined);
  const [adjusting, setAdjusting] = useState<AccountBalance | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  if (accounts.isLoading || balances.isLoading) return <Spinner />;
  if (accounts.error || balances.error) {
    return <QueryError error={accounts.error ?? balances.error} onRetry={() => { accounts.refetch(); balances.refetch(); }} />;
  }

  const balanceMap = new Map((balances.data ?? []).map((b) => [b.account_id, b]));
  const all = accounts.data ?? [];
  const active = all.filter((a) => a.is_active);
  const inactive = all.filter((a) => !a.is_active);
  const cash = active.filter((a) => a.account_type !== 'benefit');
  const benefits = active.filter((a) => a.account_type === 'benefit');
  const sum = (list: Account[]) => list.reduce((s, a) => s + Number(balanceMap.get(a.id)?.balance_cents ?? 0), 0);

  const card = (a: Account) => {
    const b = balanceMap.get(a.id);
    const bal = Number(b?.balance_cents ?? 0);
    const color = a.color ?? 'rgb(var(--accent))';
    return (
      <li key={a.id} className="card flex flex-col gap-5 transition hover:border-line">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="icon-bubble font-bold"
              style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
              aria-hidden
            >
              {a.name.trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{a.name}</p>
              <p className="truncate text-xs text-muted">
                {[a.institution_name, ACCOUNT_TYPE_LABEL[a.account_type]].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Manual
          </span>
        </div>
        <div>
          <Money cents={bal} className={`block text-2xl font-semibold tracking-tight ${bal < 0 ? 'text-expense' : ''}`} />
          <p className="mt-1 text-xs text-muted">
            Último movimento {formatDate(b?.last_movement_at)} · inicial <Money cents={a.opening_balance_cents} /> em{' '}
            {formatDate(a.opening_date)}
          </p>
        </div>
        <div className="-mx-1 flex flex-wrap gap-1 border-t border-fg/10 pt-3">
          <Link className="btn-ghost btn-sm" to={`/movimentacoes?conta=${a.id}`}>Histórico</Link>
          {a.is_active && (
            <>
              <button className="btn-ghost btn-sm" onClick={() => setTransferFrom(a.id)}>Transferir</button>
              <button className="btn-ghost btn-sm" onClick={() => b && setAdjusting(b)}>Ajustar saldo</button>
            </>
          )}
          <button className="btn-ghost btn-sm" onClick={() => setEditing({ open: true, account: a })}>Editar</button>
          {!b?.last_movement_at && (
            <button className="btn-ghost btn-sm text-expense" onClick={() => { del.reset(); setDeleting(a); }}>Excluir</button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div>
      <PageHeader
        title="Contas e Bancos"
        subtitle="Saldos calculados a partir do saldo inicial e das movimentações confirmadas."
        actions={
          <>
            <button className="btn-secondary" onClick={() => setTransferFrom(null)} disabled={active.length < 2}>
              <IconSwap width={16} height={16} /> Transferir
            </button>
            <button className="btn-primary" onClick={() => setEditing({ open: true })}>+ Nova conta</button>
          </>
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <div className="hero p-6">
          <div className="hero-sun" aria-hidden />
          <div className="hero-sheen" aria-hidden />
          <p className="eyebrow">Dinheiro em contas</p>
          <Money cents={sum(cash)} className="mt-2 block text-4xl font-semibold tracking-tight" />
          <p className="mt-2 text-xs text-muted">{cash.length} conta(s) ativa(s)</p>
        </div>
        <div className="hero-soft">
          <p className="eyebrow">Benefícios · uso restrito</p>
          <Money cents={sum(benefits)} className="mt-2 block text-4xl font-semibold tracking-tight" />
          <p className="mt-2 text-xs text-muted">Controlados à parte, fora do saldo livre</p>
        </div>
      </div>

      {all.length === 0 ? (
        <EmptyState title="Nenhuma conta cadastrada.">
          Cadastre contas bancárias, carteira de dinheiro e cartões-benefício com o saldo atual de cada um.
        </EmptyState>
      ) : (
        <>
          {cash.length > 0 && (
            <>
              <h2 className="eyebrow mb-3">Contas</h2>
              <ul className="grid gap-4 lg:grid-cols-2">{cash.map(card)}</ul>
            </>
          )}
          {benefits.length > 0 && (
            <>
              <h2 className="eyebrow mb-3 mt-8">Benefícios</h2>
              <ul className="grid gap-4 lg:grid-cols-2">{benefits.map(card)}</ul>
            </>
          )}
          {inactive.length > 0 && (
            <div className="mt-8">
              <button className="link text-sm" onClick={() => setShowInactive((v) => !v)} aria-expanded={showInactive}>
                {showInactive ? 'Ocultar' : 'Mostrar'} contas desativadas ({inactive.length})
              </button>
              {showInactive && <ul className="mt-4 grid gap-4 opacity-70 lg:grid-cols-2">{inactive.map(card)}</ul>}
            </div>
          )}
        </>
      )}

      <div className="mt-10 flex gap-3 rounded-2xl border border-dashed border-line p-5 text-sm">
        <span className="dot mt-1.5 bg-warn" aria-hidden />
        <div>
        <p className="font-semibold">Conexão bancária (Open Finance)</p>
        <p className="mt-1 text-muted">
          Ainda não disponível. Nesta versão os saldos são mantidos manualmente, sem acesso às suas contas e sem senhas
          bancárias. A integração via provedor autorizado do Open Finance Brasil está prevista para a Fase 4 e dependerá de
          contratação do provedor.
        </p>
        </div>
      </div>

      <AccountForm
        open={editing.open}
        account={editing.account}
        hasMovements={!!(editing.account && balanceMap.get(editing.account.id)?.last_movement_at)}
        onClose={() => setEditing({ open: false })}
      />
      <TransferDialog open={transferFrom !== undefined} fromId={transferFrom ?? undefined} onClose={() => setTransferFrom(undefined)} />
      <AdjustDialog balance={adjusting} onClose={() => setAdjusting(null)} />
      <ConfirmDialog
        open={!!deleting}
        title="Excluir conta"
        danger
        confirmLabel="Excluir"
        pending={del.isPending}
        error={del.error ? friendlyError(del.error) : null}
        message={<p>Excluir a conta <strong>{deleting?.name}</strong>? Só é possível quando não há lançamentos vinculados.</p>}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => {
              toast('Conta excluída.');
              setDeleting(null);
            },
          })
        }
      />
    </div>
  );
}
