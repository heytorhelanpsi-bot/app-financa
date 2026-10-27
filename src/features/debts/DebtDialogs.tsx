import { useEffect, useMemo, useState } from 'react';
import { Badge, ConfirmDialog, Field, FormError, Modal, Money, Toggle, useToast } from '@/components/ui';
import {
  useAccounts,
  useAddDebtCharge,
  useCategories,
  useDebtHistory,
  useDeleteDebt,
  usePayDebt,
  useSaveDebt,
  type DebtInput,
} from '@/hooks/data';
import { useToday } from '@/hooks/useToday';
import { centsToInput, parseMoneyToCents } from '@/lib/money';
import { friendlyError } from '@/lib/errors';
import { formatDate, isValidISODate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { supabase } from '@/lib/supabase';
import type { ChargeKind, Debt, LateConsequence, PriorityLevel, Transaction } from '@/lib/types';
import { buildCategoryOptions } from '@/features/transactions/TransactionForm';
import { useTxActions } from '@/features/transactions/TxActions';
import { CONSEQUENCE_LABEL, PRIORITY_LABEL, type DebtView } from './logic';

const PRIORITIES: PriorityLevel[] = ['critical', 'high', 'medium', 'low'];

function parseOptionalMoney(v: string): number | null | 'invalid' {
  if (!v.trim()) return null;
  const c = parseMoneyToCents(v);
  return c === null || c <= 0 ? 'invalid' : c;
}

function parseOptionalNumber(v: string, max: number): number | null | 'invalid' {
  if (!v.trim()) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : 'invalid';
}

// -----------------------------------------------------------------------------
// Cadastro / edição
// -----------------------------------------------------------------------------

export function DebtForm({ open, onClose, debt }: { open: boolean; onClose: () => void; debt?: DebtView }) {
  const save = useSaveDebt();
  const toast = useToast();
  const categories = useCategories().data ?? [];
  const accounts = useAccounts().data ?? [];
  const [id, setId] = useState(newId);
  const [showMore, setShowMore] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const hasPayments = (debt?.balance.payments_count ?? 0) > 0;

  const blank = () => ({
    creditor: '',
    description: '',
    outstanding: '',
    contracted: '',
    installment: '',
    minimum: '',
    installments: '',
    due: '',
    rate: '',
    fee: '',
    category: categories.find((c) => c.name === 'Dívidas e empréstimos' && c.is_active)?.id ?? '',
    account: '',
    priority: 'medium' as PriorityLevel,
    essential: false,
    consequence: 'none' as LateConsequence,
    consequenceNotes: '',
    notes: '',
  });
  const [f, setF] = useState(blank);
  const set = <K extends keyof ReturnType<typeof blank>>(k: K, v: ReturnType<typeof blank>[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setId(debt?.id ?? newId());
    setErrors({});
    setShowMore(false);
    save.reset();
    setF(
      debt
        ? {
            creditor: debt.creditor_name,
            description: debt.description ?? '',
            outstanding: centsToInput(debt.original_amount_cents),
            contracted: debt.contracted_amount_cents ? centsToInput(debt.contracted_amount_cents) : '',
            installment: debt.installment_amount_cents ? centsToInput(debt.installment_amount_cents) : '',
            minimum: debt.minimum_payment_cents ? centsToInput(debt.minimum_payment_cents) : '',
            installments: debt.installments_total?.toString() ?? '',
            due: debt.next_due_date ?? '',
            rate: debt.interest_rate_monthly?.toString().replace('.', ',') ?? '',
            fee: debt.late_fee_percent?.toString().replace('.', ',') ?? '',
            category: debt.category_id ?? '',
            account: debt.account_id ?? '',
            priority: debt.priority_level,
            essential: debt.is_essential,
            consequence: debt.late_consequence,
            consequenceNotes: debt.consequence_notes ?? '',
            notes: debt.notes ?? '',
          }
        : blank(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const outstanding = parseMoneyToCents(f.outstanding);
    const contracted = parseOptionalMoney(f.contracted);
    const installment = parseOptionalMoney(f.installment);
    const minimum = parseOptionalMoney(f.minimum);
    const rate = parseOptionalNumber(f.rate, 100);
    const fee = parseOptionalNumber(f.fee, 100);
    const installments = f.installments.trim() ? Number(f.installments) : null;
    if (!f.creditor.trim()) errs.creditor = 'Informe o credor.';
    if (outstanding === null || outstanding <= 0) errs.outstanding = 'Informe um valor maior que zero.';
    if (contracted === 'invalid') errs.contracted = 'Valor inválido.';
    if (installment === 'invalid') errs.installment = 'Valor inválido.';
    if (minimum === 'invalid') errs.minimum = 'Valor inválido.';
    if (rate === 'invalid') errs.rate = 'Use um percentual entre 0 e 100.';
    if (fee === 'invalid') errs.fee = 'Use um percentual entre 0 e 100.';
    if (installments !== null && (!Number.isInteger(installments) || installments < 1 || installments > 600)) {
      errs.installments = 'Entre 1 e 600.';
    }
    if (f.due && !isValidISODate(f.due)) errs.due = 'Data inválida.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      if (errs.contracted || errs.minimum || errs.rate || errs.fee || errs.installments) setShowMore(true);
      return;
    }
    const input: DebtInput = {
      creditor_name: f.creditor.trim(),
      description: f.description.trim() || null,
      original_amount_cents: outstanding!,
      contracted_amount_cents: contracted as number | null,
      installment_amount_cents: installment as number | null,
      minimum_payment_cents: minimum as number | null,
      installments_total: installments,
      next_due_date: f.due || null,
      interest_rate_monthly: rate as number | null,
      late_fee_percent: fee as number | null,
      category_id: f.category || null,
      account_id: f.account || null,
      priority_level: f.priority,
      is_essential: f.essential,
      late_consequence: f.consequence,
      consequence_notes: f.consequenceNotes.trim() || null,
      notes: f.notes.trim() || null,
    };
    save.mutate(
      { id, existing: debt, input },
      {
        onSuccess: () => {
          toast(debt ? 'Dívida atualizada.' : 'Dívida cadastrada.');
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={debt ? 'Editar dívida' : 'Nova dívida'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={save.isPending}>Cancelar</button>
          <button type="submit" form="debt-form" className="btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="debt-form" onSubmit={submit} noValidate className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <FormError message={save.error ? friendlyError(save.error) : null} />
        </div>
        <Field label="Credor" htmlFor="db-creditor" error={errors.creditor} className="col-span-2">
          <input id="db-creditor" className="input" maxLength={80} autoFocus value={f.creditor} onChange={(e) => set('creditor', e.target.value)} placeholder="Ex.: Banco, loja, companhia de luz" />
        </Field>
        <Field label="Descrição (opcional)" htmlFor="db-desc" className="col-span-2">
          <input id="db-desc" className="input" maxLength={140} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Ex.: Empréstimo pessoal, fatura atrasada" />
        </Field>
        <Field
          label="Saldo devedor hoje (R$)"
          htmlFor="db-outstanding"
          error={errors.outstanding}
          hint={hasPayments ? 'Há pagamentos: corrija com encargo ou desconto.' : 'Quanto falta pagar agora.'}
        >
          <input id="db-outstanding" className="input tabular" inputMode="decimal" disabled={hasPayments} value={f.outstanding} onChange={(e) => set('outstanding', e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Parcela (R$)" htmlFor="db-installment" error={errors.installment} hint="Valor de cada pagamento">
          <input id="db-installment" className="input tabular" inputMode="decimal" value={f.installment} onChange={(e) => set('installment', e.target.value)} placeholder="Opcional" />
        </Field>
        <Field label="Próximo vencimento" htmlFor="db-due" error={errors.due}>
          <input id="db-due" type="date" className="input" value={f.due} onChange={(e) => set('due', e.target.value)} />
        </Field>
        <Field label="Juros (% ao mês)" htmlFor="db-rate" error={errors.rate}>
          <input id="db-rate" className="input tabular" inputMode="decimal" value={f.rate} onChange={(e) => set('rate', e.target.value)} placeholder="Se souber" />
        </Field>

        <div className="col-span-2">
          <span className="label">Prioridade</span>
          <div className="segmented grid w-full grid-cols-4" role="radiogroup" aria-label="Prioridade">
            {PRIORITIES.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={f.priority === p} className={`chip ${f.priority === p ? 'chip-active' : ''}`} onClick={() => set('priority', p)}>
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        <Field label="Se atrasar, o que acontece?" htmlFor="db-consequence" className="col-span-2 sm:col-span-1">
          <select id="db-consequence" className="input" value={f.consequence} onChange={(e) => set('consequence', e.target.value as LateConsequence)}>
            {Object.entries(CONSEQUENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <div className="col-span-2 flex items-end sm:col-span-1">
          <Toggle checked={f.essential} onChange={(v) => set('essential', v)} label="Conta essencial" description="Moradia, energia, água, saúde, alimentação…" />
        </div>

        <div className="col-span-2">
          <button type="button" className="link" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>
            {showMore ? 'Ocultar detalhes' : 'Mais detalhes (mínimo, multa, nº de parcelas, categoria, observações)'}
          </button>
        </div>
        {showMore && (
          <>
            <Field label="Pagamento mínimo (R$)" htmlFor="db-min" error={errors.minimum}>
              <input id="db-min" className="input tabular" inputMode="decimal" value={f.minimum} onChange={(e) => set('minimum', e.target.value)} placeholder="Opcional" />
            </Field>
            <Field label="Valor contratado (R$)" htmlFor="db-contracted" error={errors.contracted} hint="Valor original do contrato">
              <input id="db-contracted" className="input tabular" inputMode="decimal" value={f.contracted} onChange={(e) => set('contracted', e.target.value)} placeholder="Opcional" />
            </Field>
            <Field label="Multa por atraso (%)" htmlFor="db-fee" error={errors.fee}>
              <input id="db-fee" className="input tabular" inputMode="decimal" value={f.fee} onChange={(e) => set('fee', e.target.value)} placeholder="Se souber" />
            </Field>
            <Field label="Nº de parcelas restantes" htmlFor="db-n" error={errors.installments}>
              <input id="db-n" className="input tabular" inputMode="numeric" value={f.installments} onChange={(e) => set('installments', e.target.value)} placeholder="Opcional" />
            </Field>
            <Field label="Categoria" htmlFor="db-cat">
              <select id="db-cat" className="input" value={f.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">Sem categoria</option>
                {buildCategoryOptions(categories, 'expense', f.category).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Conta usada para pagar" htmlFor="db-acc">
              <select id="db-acc" className="input" value={f.account} onChange={(e) => set('account', e.target.value)}>
                <option value="">Escolher na hora</option>
                {accounts.filter((a) => a.is_active || a.id === f.account).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Detalhes da consequência" htmlFor="db-cn" className="col-span-2">
              <input id="db-cn" className="input" maxLength={500} value={f.consequenceNotes} onChange={(e) => set('consequenceNotes', e.target.value)} placeholder="Ex.: corte após 2 faturas em atraso" />
            </Field>
            <Field label="Observações" htmlFor="db-notes" className="col-span-2">
              <textarea id="db-notes" className="input min-h-[72px]" maxLength={1000} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Pagamento (integral ou parcial)
// -----------------------------------------------------------------------------

export function PayDebtDialog({
  debt,
  suggestedCents,
  onClose,
}: {
  debt: DebtView | null;
  suggestedCents?: number;
  onClose: () => void;
}) {
  const today = useToday();
  const accounts = useAccounts().data ?? [];
  const pay = usePayDebt();
  const toast = useToast();
  const [key, setKey] = useState(newId);
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(today);
  const [total, setTotal] = useState('');
  const [charges, setCharges] = useState('');
  const [advance, setAdvance] = useState(true);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!debt) return;
    const amount = suggestedCents && suggestedCents > 0 ? suggestedCents : debt.amountDue;
    const chargesOut = Number(debt.balance.charges_outstanding_cents);
    setKey(newId());
    setAccountId(debt.account_id ?? accounts.find((a) => a.is_active && a.account_type !== 'benefit')?.id ?? '');
    setDate(today);
    setTotal(centsToInput(amount));
    setCharges(chargesOut > 0 ? centsToInput(Math.min(chargesOut, amount)) : '');
    setAdvance(!!debt.next_due_date && amount >= debt.amountDue && amount < debt.outstanding);
    setNotes('');
    setErrors({});
    pay.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debt?.id, suggestedCents]);

  const totalCents = parseMoneyToCents(total);
  const chargesCents = charges.trim() ? parseMoneyToCents(charges) : 0;
  const principalCents = totalCents !== null && chargesCents !== null ? totalCents - chargesCents : null;
  const after = debt && principalCents !== null && chargesCents !== null
    ? Math.max(0, Number(debt.balance.principal_outstanding_cents) - principalCents) +
      Math.max(0, Number(debt.balance.charges_outstanding_cents) - chargesCents)
    : null;

  if (!debt) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!accountId) errs.account = 'Informe a conta utilizada.';
    if (!isValidISODate(date)) errs.date = 'Data inválida.';
    else if (date > today) errs.date = 'A data não pode estar no futuro.';
    if (totalCents === null || totalCents <= 0) errs.total = 'Informe um valor maior que zero.';
    if (chargesCents === null || chargesCents < 0) errs.charges = 'Valor inválido.';
    else if (totalCents !== null && chargesCents > totalCents) errs.charges = 'Não pode passar do valor pago.';
    else if (principalCents !== null && principalCents > Number(debt!.balance.principal_outstanding_cents)) {
      errs.total = 'O principal pago passaria do saldo. Informe a diferença como juros/encargos.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    pay.mutate(
      {
        debt_id: debt!.id,
        account_id: accountId,
        date,
        principal_cents: principalCents!,
        charges_cents: chargesCents!,
        advance_due: advance,
        notes,
        key,
      },
      {
        onSuccess: (r) => {
          toast(r.paid_off ? 'Dívida quitada!' : 'Pagamento registrado.');
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Pagar ${debt.creditor_name}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={pay.isPending}>Cancelar</button>
          <button type="submit" form="pay-debt-form" className="btn-primary" disabled={pay.isPending}>
            {pay.isPending ? 'Registrando…' : 'Confirmar pagamento'}
          </button>
        </>
      }
    >
      <form id="pay-debt-form" onSubmit={submit} noValidate className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <FormError message={pay.error ? friendlyError(pay.error) : null} />
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-fg/10 p-3 text-xs">
            <div>
              <p className="text-muted">Saldo devedor</p>
              <Money cents={debt.outstanding} className="text-sm font-semibold" />
            </div>
            <div>
              <p className="text-muted">Encargos em aberto</p>
              <Money cents={debt.balance.charges_outstanding_cents} className="text-sm font-semibold" />
            </div>
            <div>
              <p className="text-muted">Vencimento</p>
              <p className="text-sm font-semibold">{formatDate(debt.next_due_date)}</p>
            </div>
          </div>
        </div>
        <Field label="Valor pago (R$)" htmlFor="pd-total" error={errors.total} className="col-span-2 sm:col-span-1">
          <input id="pd-total" className="input tabular" inputMode="decimal" autoFocus value={total} onChange={(e) => setTotal(e.target.value)} />
        </Field>
        <Field label="Desse valor, juros/encargos (R$)" htmlFor="pd-charges" error={errors.charges} hint="O restante abate o principal" className="col-span-2 sm:col-span-1">
          <input id="pd-charges" className="input tabular" inputMode="decimal" value={charges} onChange={(e) => setCharges(e.target.value)} placeholder="0,00" />
        </Field>
        <div className="col-span-2 flex flex-wrap gap-2 text-xs">
          {[
            ['Parcela', debt.amountDue],
            ['Mínimo', debt.minimum_payment_cents ?? 0],
            ['Quitar tudo', debt.outstanding],
          ]
            .filter(([, v]) => Number(v) > 0)
            .map(([label, v]) => (
              <button key={label as string} type="button" className="pill-action" onClick={() => setTotal(centsToInput(v as number))}>
                {label}: <Money cents={v as number} className="ml-1" />
              </button>
            ))}
        </div>
        <Field label="Conta de origem" htmlFor="pd-acc" error={errors.account}>
          <select id="pd-acc" className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Selecione…</option>
            {accounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Data do pagamento" htmlFor="pd-date" error={errors.date}>
          <input id="pd-date" type="date" className="input" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {debt.next_due_date && (
          <div className="col-span-2">
            <Toggle checked={advance} onChange={setAdvance} label="Avançar o vencimento para o mês seguinte" description="Use quando este pagamento quita a parcela do mês." />
          </div>
        )}
        <Field label="Observação (opcional)" htmlFor="pd-notes" className="col-span-2">
          <input id="pd-notes" className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {after !== null && (
          <p className="col-span-2 text-sm">
            Saldo devedor após o pagamento: <Money cents={after} className="font-semibold" />
            {after === 0 && <span className="ml-2 font-semibold text-income">quitada</span>}
          </p>
        )}
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Encargo / desconto
// -----------------------------------------------------------------------------

const CHARGE_LABEL: Record<ChargeKind, string> = { interest: 'Juros', fine: 'Multa', fee: 'Tarifa', discount: 'Desconto' };

export function ChargeDialog({ debt, onClose }: { debt: DebtView | null; onClose: () => void }) {
  const today = useToday();
  const add = useAddDebtCharge();
  const toast = useToast();
  const [key, setKey] = useState(newId);
  const [kind, setKind] = useState<ChargeKind>('interest');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!debt) return;
    setKey(newId());
    setKind('interest');
    setAmount('');
    setDate(today);
    setDescription('');
    setError(null);
    add.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debt?.id]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseMoneyToCents(amount);
    if (cents === null || cents <= 0) return setError('Informe um valor maior que zero.');
    if (!isValidISODate(date)) return setError('Data inválida.');
    setError(null);
    add.mutate(
      { debt_id: debt!.id, kind, amount_cents: cents, date, description, key },
      { onSuccess: () => { toast(kind === 'discount' ? 'Desconto registrado.' : 'Encargo registrado.'); onClose(); } },
    );
  }

  return (
    <Modal
      open={!!debt}
      onClose={onClose}
      title="Registrar encargo ou desconto"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={add.isPending}>Cancelar</button>
          <button type="submit" form="charge-form" className="btn-primary" disabled={add.isPending}>{add.isPending ? 'Salvando…' : 'Registrar'}</button>
        </>
      }
    >
      {debt && (
        <form id="charge-form" onSubmit={submit} noValidate className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <FormError message={error ?? (add.error ? friendlyError(add.error) : null)} />
            <p className="text-sm text-muted">
              Juros, multas e tarifas aumentam o saldo devedor separados do principal. Descontos reduzem encargos em aberto.
              Tudo fica no histórico.
            </p>
          </div>
          <div className="col-span-2">
            <div className="segmented grid w-full grid-cols-4" role="radiogroup" aria-label="Tipo">
              {(Object.keys(CHARGE_LABEL) as ChargeKind[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip ${kind === k ? 'chip-active' : ''}`} onClick={() => setKind(k)}>
                  {CHARGE_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          <Field label="Valor (R$)" htmlFor="ch-amount">
            <input id="ch-amount" className="input tabular" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
          </Field>
          <Field label="Data" htmlFor="ch-date">
            <input id="ch-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Descrição (opcional)" htmlFor="ch-desc" className="col-span-2">
            <input id="ch-desc" className="input" maxLength={140} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </form>
      )}
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Detalhes + histórico
// -----------------------------------------------------------------------------

export function DebtDetails({
  debt,
  onClose,
  onPay,
  onCharge,
  onEdit,
}: {
  debt: DebtView | null;
  onClose: () => void;
  onPay: (d: DebtView) => void;
  onCharge: (d: DebtView) => void;
  onEdit: (d: DebtView) => void;
}) {
  const history = useDebtHistory(debt?.id ?? null);
  const save = useSaveDebt();
  const del = useDeleteDebt();
  const toast = useToast();
  const { openReverse } = useTxActions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyTx, setBusyTx] = useState<string | null>(null);

  const timeline = useMemo(() => {
    const items: { id: string; date: string; kind: 'payment' | 'charge'; data: any }[] = [];
    for (const p of history.data?.payments ?? []) items.push({ id: p.id, date: p.payment_date, kind: 'payment', data: p });
    for (const c of history.data?.charges ?? []) items.push({ id: c.id, date: c.charge_date, kind: 'charge', data: c });
    return items.sort((a, b) => b.date.localeCompare(a.date));
  }, [history.data]);

  if (!debt) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const b = debt.balance;

  async function reversePayment(transactionId: string) {
    setBusyTx(transactionId);
    const { data, error } = await supabase.from('transactions').select('*').eq('id', transactionId).single();
    setBusyTx(null);
    if (error || !data) return toast(friendlyError(error), 'error');
    openReverse(data as Transaction);
  }

  const setStatus = (status: Debt['debt_status'], msg: string) =>
    save.mutate(
      { id: debt.id, existing: debt, input: { debt_status: status } },
      { onSuccess: () => { toast(msg); onClose(); }, onError: (e) => toast(friendlyError(e), 'error') },
    );

  return (
    <Modal open onClose={onClose} title={debt.creditor_name} wide>
      {debt.description && <p className="-mt-1 mb-4 text-sm text-muted">{debt.description}</p>}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Saldo devedor</p>
          <Money cents={debt.outstanding} className="block text-4xl font-semibold tracking-tight" />
        </div>
        <div className="flex flex-wrap gap-2">
          {debt.debt_status === 'active' && (
            <button className="btn-primary" onClick={() => onPay(debt)}>Pagar</button>
          )}
          <button className="btn-secondary" onClick={() => onCharge(debt)}>Encargo/desconto</button>
          <button className="btn-secondary" onClick={() => onEdit(debt)}>Editar</button>
        </div>
      </div>

      <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2 rounded-2xl border border-fg/10 px-4 py-3 text-sm sm:grid-cols-3">
        {(
          [
            ['Principal em aberto', <Money key="p" cents={b.principal_outstanding_cents} />],
            ['Encargos em aberto', <Money key="c" cents={b.charges_outstanding_cents} />],
            ['Total já pago', <Money key="t" cents={b.total_paid_cents} />],
            ['Parcela / devido', <Money key="d" cents={debt.amountDue} />],
            ['Vencimento', formatDate(debt.next_due_date)],
            ['Juros', debt.interest_rate_monthly !== null ? `${Number(debt.interest_rate_monthly).toLocaleString('pt-BR')}% a.m.` : '—'],
            ['Prioridade', PRIORITY_LABEL[debt.priority_level]],
            ['Se atrasar', CONSEQUENCE_LABEL[debt.late_consequence]],
            ['Contratado', debt.contracted_amount_cents ? <Money key="k" cents={debt.contracted_amount_cents} /> : '—'],
          ] as [string, React.ReactNode][]
        ).map(([k, v]) => (
          <div key={k} className="py-1">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {debt.consequence_notes && <p className="mb-4 text-sm"><span className="text-muted">Consequência: </span>{debt.consequence_notes}</p>}

      <h3 className="eyebrow mb-2">Histórico</h3>
      {history.isLoading ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : timeline.length === 0 ? (
        <p className="text-sm text-muted">Nenhum pagamento ou encargo registrado.</p>
      ) : (
        <ul className="divide-y divide-fg/5 rounded-2xl border border-fg/10">
          {timeline.map((item) =>
            item.kind === 'payment' ? (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className={`font-medium ${item.data.reversed_at ? 'text-muted line-through' : ''}`}>Pagamento</p>
                  <p className="text-xs text-muted">
                    {formatDate(item.date)} · principal <Money cents={item.data.principal_cents} />
                    {item.data.charges_cents > 0 && <> · encargos <Money cents={item.data.charges_cents} /></>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.data.reversed_at ? (
                    <Badge>Estornado</Badge>
                  ) : (
                    <button className="btn-ghost btn-sm text-expense" disabled={busyTx === item.data.transaction_id} onClick={() => reversePayment(item.data.transaction_id)}>
                      Estornar
                    </button>
                  )}
                  <Money cents={-item.data.amount_cents} className="font-semibold text-expense" />
                </div>
              </li>
            ) : (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{CHARGE_LABEL[item.data.charge_kind as ChargeKind]}</p>
                  <p className="text-xs text-muted">{formatDate(item.date)}{item.data.description ? ` · ${item.data.description}` : ''}</p>
                </div>
                <Money cents={item.data.charge_kind === 'discount' ? -item.data.amount_cents : item.data.amount_cents} signed className={item.data.charge_kind === 'discount' ? 'text-income' : 'text-expense-forecast'} />
              </li>
            ),
          )}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap gap-2 border-t border-fg/10 pt-4">
        {debt.debt_status === 'archived' ? (
          <button className="btn-ghost btn-sm" onClick={() => setStatus(debt.outstanding > 0 ? 'active' : 'paid_off', 'Dívida reativada.')}>Reativar</button>
        ) : (
          <button className="btn-ghost btn-sm" onClick={() => setStatus('archived', 'Dívida arquivada.')}>Arquivar</button>
        )}
        {b.payments_count === 0 && (
          <button className="btn-ghost btn-sm text-expense" onClick={() => { del.reset(); setConfirmDelete(true); }}>Excluir</button>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Excluir dívida"
        danger
        confirmLabel="Excluir"
        pending={del.isPending}
        error={del.error ? friendlyError(del.error) : null}
        message={<p>Excluir <strong>{debt.creditor_name}</strong>? Só é possível enquanto não houver pagamentos.</p>}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => del.mutate(debt.id, { onSuccess: () => { toast('Dívida excluída.'); setConfirmDelete(false); onClose(); } })}
      />
    </Modal>
  );
}
