import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ConfirmDialog, Field, FormError, Modal, Money, Toggle, useToast } from '@/components/ui';
import {
  useAccounts,
  useAuditTrail,
  useCategories,
  useDeleteTransaction,
  useReverseTransaction,
  useSettleTransaction,
  useUpdateTransactionFields,
} from '@/hooks/data';
import { useToday } from '@/hooks/useToday';
import { centsToInput, parseMoneyToCents } from '@/lib/money';
import { friendlyError } from '@/lib/errors';
import { formatDate, isValidISODate } from '@/lib/dates';
import { newId } from '@/lib/id';
import {
  ACCOUNT_TYPE_LABEL,
  PAYMENT_METHOD_LABEL,
  TYPE_LABEL,
  amountColor,
  displayStatus,
  isOpen,
  isSettled,
} from '@/lib/labels';
import type { Transaction } from '@/lib/types';
import { TransactionForm } from './TransactionForm';
import { StatusBadge } from './TransactionList';

type Dialog =
  | { kind: 'none' }
  | { kind: 'form'; mode: 'new' | 'edit' | 'duplicate'; tx?: Transaction; type?: 'income' | 'expense' }
  | { kind: 'settle'; tx: Transaction }
  | { kind: 'reverse'; tx: Transaction }
  | { kind: 'delete'; tx: Transaction }
  | { kind: 'details'; tx: Transaction };

interface TxActionsApi {
  openNew: (type?: 'income' | 'expense') => void;
  openEdit: (tx: Transaction) => void;
  openDuplicate: (tx: Transaction) => void;
  openSettle: (tx: Transaction) => void;
  openReverse: (tx: Transaction) => void;
  openDelete: (tx: Transaction) => void;
  openDetails: (tx: Transaction) => void;
}

const Ctx = createContext<TxActionsApi | null>(null);

export function useTxActions() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('TxActionsProvider ausente');
  return ctx;
}

export function TxActionsProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const close = () => setDialog({ kind: 'none' });
  const api: TxActionsApi = {
    openNew: (type = 'expense') => setDialog({ kind: 'form', mode: 'new', type }),
    openEdit: (tx) => setDialog({ kind: 'form', mode: 'edit', tx }),
    openDuplicate: (tx) => setDialog({ kind: 'form', mode: 'duplicate', tx }),
    openSettle: (tx) => setDialog({ kind: 'settle', tx }),
    openReverse: (tx) => setDialog({ kind: 'reverse', tx }),
    openDelete: (tx) => setDialog({ kind: 'delete', tx }),
    openDetails: (tx) => setDialog({ kind: 'details', tx }),
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <TransactionForm
        open={dialog.kind === 'form'}
        onClose={close}
        mode={dialog.kind === 'form' ? dialog.mode : 'new'}
        tx={dialog.kind === 'form' ? dialog.tx : undefined}
        initialType={dialog.kind === 'form' ? dialog.type : undefined}
      />
      <SettleDialog tx={dialog.kind === 'settle' ? dialog.tx : null} onClose={close} />
      <ReverseDialog tx={dialog.kind === 'reverse' ? dialog.tx : null} onClose={close} />
      <DeleteDialog tx={dialog.kind === 'delete' ? dialog.tx : null} onClose={close} />
      <DetailsDialog tx={dialog.kind === 'details' ? dialog.tx : null} onClose={close} api={api} />
    </Ctx.Provider>
  );
}

// -----------------------------------------------------------------------------
// Confirmar pagamento / recebimento
// -----------------------------------------------------------------------------

function SettleDialog({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const today = useToday();
  const accounts = useAccounts().data ?? [];
  const settle = useSettleTransaction();
  const toast = useToast();
  const [key, setKey] = useState(newId);
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (tx) {
      // Nova chave a cada abertura; cliques repetidos reutilizam a mesma chave.
      setKey(newId());
      setAccountId(tx.account_id ?? accounts.find((a) => a.is_active && a.account_type !== 'benefit')?.id ?? '');
      setDate(today);
      setAmount(centsToInput(tx.amount_cents));
      setErrors({});
      settle.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx?.id]);

  if (!tx) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const expense = tx.direction === 'out';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const cents = parseMoneyToCents(amount);
    if (!accountId) errs.accountId = 'Informe a conta.';
    if (!isValidISODate(date)) errs.date = 'Data inválida.';
    else if (date > today) errs.date = 'A data efetiva não pode estar no futuro.';
    if (cents === null || cents <= 0) errs.amount = 'Valor inválido.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    settle.mutate(
      { id: tx!.id, account_id: accountId, settled_at: date, amount_cents: cents!, key },
      {
        onSuccess: () => {
          toast(expense ? 'Pagamento registrado.' : 'Recebimento registrado.');
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={expense ? 'Confirmar pagamento' : 'Confirmar recebimento'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={settle.isPending}>
            Cancelar
          </button>
          <button type="submit" form="settle-form" className="btn-primary" disabled={settle.isPending}>
            {settle.isPending ? 'Registrando…' : 'Confirmar'}
          </button>
        </>
      }
    >
      <form id="settle-form" onSubmit={submit} noValidate className="grid gap-3">
        <FormError message={settle.error ? friendlyError(settle.error) : null} />
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
          <p className="font-medium">{tx.description}</p>
          <p className="text-muted">
            Previsto: <Money cents={tx.amount_cents} /> · vencimento {formatDate(tx.due_date ?? tx.competence_date)}
          </p>
        </div>
        <Field label={expense ? 'Conta de origem' : 'Conta de destino'} htmlFor="st-acc" error={errors.accountId}>
          <select id="st-acc" className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Selecione…</option>
            {accounts
              .filter((a) => a.is_active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.account_type === 'benefit' ? ` — ${ACCOUNT_TYPE_LABEL.benefit}` : ''}
                </option>
              ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data efetiva" htmlFor="st-date" error={errors.date}>
            <input id="st-date" type="date" className="input" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={expense ? 'Valor pago (R$)' : 'Valor recebido (R$)'} htmlFor="st-amount" error={errors.amount}>
            <input
              id="st-amount"
              className="input tabular"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </div>
        <p className="text-xs text-muted">
          O saldo da conta será atualizado pelo valor efetivamente {expense ? 'pago' : 'recebido'}. Para corrigir depois, use o
          estorno.
        </p>
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Estorno
// -----------------------------------------------------------------------------

function ReverseDialog({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const reverse = useReverseTransaction();
  const toast = useToast();
  const [key, setKey] = useState(newId);
  const [reason, setReason] = useState('');
  const [reopen, setReopen] = useState(true);

  useEffect(() => {
    if (tx) {
      setKey(newId());
      setReason('');
      setReopen(tx.transaction_type === 'income' || tx.transaction_type === 'expense');
      reverse.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx?.id]);

  if (!tx) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const canReopen = tx.transaction_type === 'income' || tx.transaction_type === 'expense';

  return (
    <Modal
      open
      onClose={onClose}
      title="Estornar lançamento"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={reverse.isPending}>
            Voltar
          </button>
          <button
            className="btn-danger"
            disabled={reverse.isPending}
            onClick={() =>
              reverse.mutate(
                { id: tx.id, reason, reopen: canReopen && reopen, key },
                {
                  onSuccess: () => {
                    toast('Estorno registrado.');
                    onClose();
                  },
                },
              )
            }
          >
            {reverse.isPending ? 'Estornando…' : 'Estornar'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 text-sm">
        <FormError message={reverse.error ? friendlyError(reverse.error) : null} />
        <p>
          Será criado um lançamento de estorno de <Money cents={tx.settled_amount_cents} /> na mesma conta, anulando o efeito no
          saldo. O lançamento original permanece no histórico, marcado como estornado.
          {tx.transaction_type === 'transfer' && ' As duas pontas da transferência serão estornadas.'}
        </p>
        <Field label="Motivo (opcional)" htmlFor="rv-reason">
          <input id="rv-reason" className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {canReopen && (
          <Toggle
            checked={reopen}
            onChange={setReopen}
            label={`Reabrir como ${tx.direction === 'out' ? 'conta a pagar' : 'valor a receber'} pendente`}
            description="Útil para corrigir valor, conta ou data e confirmar novamente."
          />
        )}
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Exclusão (somente lançamentos não efetivados)
// -----------------------------------------------------------------------------

function DeleteDialog({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const del = useDeleteTransaction();
  const toast = useToast();
  useEffect(() => {
    if (tx) del.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx?.id]);
  return (
    <ConfirmDialog
      open={!!tx}
      title="Excluir lançamento"
      danger
      confirmLabel="Excluir"
      pending={del.isPending}
      error={del.error ? friendlyError(del.error) : null}
      message={
        <p>
          Excluir <strong>{tx?.description}</strong>? Esta ação fica registrada na auditoria. Lançamentos já pagos ou recebidos
          não podem ser excluídos — use o estorno.
        </p>
      }
      onClose={onClose}
      onConfirm={() =>
        tx &&
        del.mutate(tx.id, {
          onSuccess: () => {
            toast('Lançamento excluído.');
            onClose();
          },
        })
      }
    />
  );
}

// -----------------------------------------------------------------------------
// Detalhes + ações
// -----------------------------------------------------------------------------

const CONTEXT_LABEL: Record<string, string> = {
  settle: 'Pagamento/recebimento confirmado',
  transfer: 'Transferência',
  adjust: 'Ajuste de saldo',
  reverse: 'Estorno',
};

function DetailsDialog({ tx, onClose, api }: { tx: Transaction | null; onClose: () => void; api: TxActionsApi }) {
  const today = useToday();
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];
  const audit = useAuditTrail(tx?.id ?? null);
  const update = useUpdateTransactionFields();
  const toast = useToast();

  useEffect(() => {
    if (tx) update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx?.id]);

  if (!tx) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const account = accounts.find((a) => a.id === tx.account_id);
  const category = categories.find((c) => c.id === tx.category_id);
  const open = isOpen(tx);
  const settled = isSettled(tx);
  const userType = tx.transaction_type === 'income' || tx.transaction_type === 'expense';
  const go = (fn: (t: Transaction) => void) => () => fn(tx);

  const patch = (p: Partial<Pick<Transaction, 'status' | 'archived_at'>>, msg: string) =>
    update.mutate({ tx, patch: p }, { onSuccess: () => { toast(msg); onClose(); } });

  const rows: [string, React.ReactNode][] = [
    ['Tipo', TYPE_LABEL[tx.transaction_type]],
    ['Situação', <StatusBadge key="s" status={displayStatus(tx, today)} reversed={!!tx.reversed_at} />],
    ['Valor previsto', <Money key="a" cents={tx.amount_cents} />],
    ...(settled ? ([[tx.direction === 'out' ? 'Valor pago' : 'Valor recebido', <Money key="b" cents={tx.settled_amount_cents} />]] as [string, React.ReactNode][]) : []),
    ['Competência', formatDate(tx.competence_date)],
    ['Vencimento', formatDate(tx.due_date)],
    ['Data efetiva', formatDate(tx.settled_at)],
    ['Conta', account ? account.name : '—'],
    ['Categoria', category ? category.name : 'Sem categoria'],
    ['Forma de pagamento', tx.payment_method ? PAYMENT_METHOD_LABEL[tx.payment_method] : '—'],
    ['Etiquetas', tx.tags.length ? tx.tags.join(', ') : '—'],
    ['Observações', tx.notes ?? '—'],
  ];

  return (
    <Modal open onClose={onClose} title={tx.description} wide>
      <FormError message={update.error ? friendlyError(update.error) : null} />
      <p className={`mb-4 text-2xl font-bold ${amountColor(tx)}`}>
        <Money cents={tx.direction === 'out' ? -(tx.settled_amount_cents ?? tx.amount_cents) : tx.settled_amount_cents ?? tx.amount_cents} signed />
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {open && userType && (
          <button className="btn-primary" onClick={go(api.openSettle)}>
            {tx.direction === 'out' ? 'Pagar' : 'Receber'}
          </button>
        )}
        {userType && tx.status !== 'canceled' && (
          <button className="btn-secondary" onClick={go(api.openEdit)}>Editar</button>
        )}
        {userType && <button className="btn-secondary" onClick={go(api.openDuplicate)}>Duplicar</button>}
        {open && userType && (
          <button className="btn-secondary" disabled={update.isPending} onClick={() => patch({ status: 'canceled' }, 'Lançamento cancelado.')}>
            Cancelar lançamento
          </button>
        )}
        {tx.status === 'canceled' && !tx.archived_at && (
          <button className="btn-secondary" disabled={update.isPending} onClick={() => patch({ status: 'pending' }, 'Lançamento reativado.')}>
            Reativar
          </button>
        )}
        {(settled || tx.status === 'canceled') && (
          <button
            className="btn-secondary"
            disabled={update.isPending}
            onClick={() =>
              patch(
                { archived_at: tx.archived_at ? null : new Date().toISOString() },
                tx.archived_at ? 'Lançamento desarquivado.' : 'Lançamento arquivado.',
              )
            }
          >
            {tx.archived_at ? 'Desarquivar' : 'Arquivar'}
          </button>
        )}
        {settled && !tx.reversed_at && tx.transaction_type !== 'reversal' && (
          <button className="btn-secondary text-expense" onClick={go(api.openReverse)}>Estornar</button>
        )}
        {!settled && userType && (
          <button className="btn-ghost text-expense" onClick={go(api.openDelete)}>Excluir</button>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-line/60 py-1">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mb-2 mt-5 text-sm font-semibold">Histórico</h3>
      {audit.isLoading ? (
        <p className="text-xs text-muted">Carregando…</p>
      ) : (
        <ol className="space-y-1 text-xs text-muted">
          {(audit.data ?? []).map((a) => (
            <li key={a.id}>
              {new Date(a.created_at).toLocaleString('pt-BR')} —{' '}
              {a.context ? CONTEXT_LABEL[a.context] ?? a.context : a.action === 'insert' ? 'Criado' : a.action === 'update' ? 'Alterado' : 'Excluído'}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
