import { useEffect, useMemo, useState } from 'react';
import { Field, FormError, Modal } from '@/components/ui';
import { useAccounts, useCategories, useSaveTransaction, type TransactionInput } from '@/hooks/data';
import { useToday } from '@/hooks/useToday';
import { centsToInput, parseMoneyToCents } from '@/lib/money';
import { friendlyError } from '@/lib/errors';
import { isValidISODate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { ACCOUNT_TYPE_LABEL, PAYMENT_METHOD_LABEL, isSettled } from '@/lib/labels';
import type { Category, PaymentMethod, Transaction } from '@/lib/types';
import { useToast } from '@/components/ui';

type Situation = 'forecast' | 'pending' | 'settled';

interface FormState {
  type: 'income' | 'expense';
  description: string;
  amount: string;
  situation: Situation;
  dueDate: string;
  competenceDate: string;
  competenceTouched: boolean;
  accountId: string;
  categoryId: string;
  paymentMethod: PaymentMethod | '';
  settledAt: string;
  settledAmount: string;
  tags: string;
  notes: string;
}

export function TransactionForm({
  open,
  onClose,
  mode,
  tx,
  initialType = 'expense',
}: {
  open: boolean;
  onClose: () => void;
  mode: 'new' | 'edit' | 'duplicate';
  tx?: Transaction;
  initialType?: 'income' | 'expense';
}) {
  const today = useToday();
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];
  const save = useSaveTransaction();
  const toast = useToast();

  // O id é gerado uma única vez por abertura: reenvios não duplicam o lançamento.
  const [id, setId] = useState(() => newId());
  const [showMore, setShowMore] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<FormState>(() => initialState());

  function initialState(): FormState {
    const defaultAccount = accounts.find((a) => a.is_active && a.account_type !== 'benefit')?.id ?? '';
    if (tx && (mode === 'edit' || mode === 'duplicate')) {
      const editingSettled = mode === 'edit' && isSettled(tx);
      return {
        type: tx.transaction_type === 'income' ? 'income' : 'expense',
        description: tx.description,
        amount: centsToInput(tx.amount_cents),
        situation: editingSettled ? 'settled' : tx.status === 'forecast' ? 'forecast' : 'pending',
        dueDate: mode === 'duplicate' ? today : tx.due_date ?? '',
        competenceDate: mode === 'duplicate' ? today : tx.competence_date,
        competenceTouched: mode === 'edit',
        accountId: tx.account_id ?? '',
        categoryId: tx.category_id ?? '',
        paymentMethod: tx.payment_method ?? '',
        settledAt: tx.settled_at ?? today,
        settledAmount: centsToInput(tx.settled_amount_cents ?? tx.amount_cents),
        tags: tx.tags.join(', '),
        notes: tx.notes ?? '',
      };
    }
    return {
      type: initialType,
      description: '',
      amount: '',
      situation: 'pending',
      dueDate: today,
      competenceDate: today,
      competenceTouched: false,
      accountId: defaultAccount,
      categoryId: '',
      paymentMethod: '',
      settledAt: today,
      settledAmount: '',
      tags: '',
      notes: '',
    };
  }

  useEffect(() => {
    if (open) {
      setId(mode === 'edit' && tx ? tx.id : newId());
      setForm(initialState());
      setErrors({});
      setShowMore(false);
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const lockedFinancials = mode === 'edit' && !!tx && isSettled(tx);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const categoryOptions = useMemo(() => buildCategoryOptions(categories, form.type, form.categoryId), [
    categories,
    form.type,
    form.categoryId,
  ]);
  const accountOptions = accounts.filter((a) => a.is_active || a.id === form.accountId);

  function validate(): TransactionInput | null {
    const e: Record<string, string> = {};
    const amount = parseMoneyToCents(form.amount);
    if (!form.description.trim()) e.description = 'Informe uma descrição.';
    else if (form.description.trim().length > 140) e.description = 'Máximo de 140 caracteres.';
    if (amount === null || amount <= 0) e.amount = 'Informe um valor maior que zero.';
    if (form.dueDate && !isValidISODate(form.dueDate)) e.dueDate = 'Data inválida.';
    if (!isValidISODate(form.competenceDate)) e.competenceDate = 'Data inválida.';

    let settledAmount: number | null = null;
    if (form.situation === 'settled' && !lockedFinancials) {
      if (!form.accountId) e.accountId = 'Informe a conta utilizada.';
      if (!isValidISODate(form.settledAt)) e.settledAt = 'Data inválida.';
      else if (form.settledAt > today) e.settledAt = 'A data efetiva não pode estar no futuro.';
      settledAmount = form.settledAmount.trim() ? parseMoneyToCents(form.settledAmount) : amount;
      if (settledAmount === null || settledAmount <= 0) e.settledAmount = 'Valor inválido.';
    }
    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length > 20) e.tags = 'Máximo de 20 etiquetas.';
    if (tags.some((t) => t.length > 30)) e.tags = 'Cada etiqueta deve ter até 30 caracteres.';
    if (form.notes.length > 1000) e.notes = 'Máximo de 1000 caracteres.';

    setErrors(e);
    if (Object.keys(e).length) return null;

    const settled = form.situation === 'settled';
    return {
      description: form.description.trim(),
      transaction_type: form.type,
      amount_cents: amount!,
      category_id: form.categoryId || null,
      account_id: form.accountId || null,
      competence_date: form.competenceDate,
      due_date: form.dueDate || null,
      status: settled ? (form.type === 'expense' ? 'paid' : 'received') : (form.situation as 'forecast' | 'pending'),
      settled_at: settled ? form.settledAt : null,
      settled_amount_cents: settled ? settledAmount : null,
      payment_method: form.paymentMethod || null,
      tags: [...new Set(tags)],
      notes: form.notes.trim() || null,
    };
  }

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const input = validate();
    if (!input) return;
    save.mutate(
      { id, existing: mode === 'edit' ? tx : undefined, input },
      {
        onSuccess: () => {
          toast(mode === 'edit' ? 'Lançamento atualizado.' : 'Lançamento salvo.');
          onClose();
        },
      },
    );
  }

  const title = mode === 'edit' ? 'Editar lançamento' : mode === 'duplicate' ? 'Duplicar lançamento' : 'Novo lançamento';
  const isExpense = form.type === 'expense';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </button>
          <button type="submit" form="tx-form" className="btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="tx-form" onSubmit={submit} noValidate className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <FormError message={save.error ? friendlyError(save.error) : null} />
          {lockedFinancials && (
            <p className="mb-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
              Lançamento efetivado: valor, conta, data efetiva e tipo só podem ser corrigidos por estorno.
            </p>
          )}
        </div>

        <div className="col-span-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo">
          {(['expense', 'income'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={form.type === t}
              disabled={lockedFinancials}
              onClick={() => setForm((f) => ({ ...f, type: t, categoryId: '' }))}
              className={`btn border ${
                form.type === t
                  ? t === 'expense'
                    ? 'border-expense bg-expense/15 text-expense'
                    : 'border-income bg-income/15 text-income'
                  : 'border-line text-muted'
              }`}
            >
              {t === 'expense' ? 'Despesa' : 'Receita'}
            </button>
          ))}
        </div>

        <Field label="Descrição" htmlFor="tx-desc" error={errors.description} className="col-span-2">
          <input
            id="tx-desc"
            className="input"
            value={form.description}
            maxLength={140}
            autoFocus
            onChange={(e) => set('description', e.target.value)}
            placeholder={isExpense ? 'Ex.: Conta de luz' : 'Ex.: Salário'}
          />
        </Field>

        <Field label="Valor (R$)" htmlFor="tx-amount" error={errors.amount}>
          <input
            id="tx-amount"
            className="input tabular"
            inputMode="decimal"
            value={form.amount}
            disabled={lockedFinancials}
            onChange={(e) => set('amount', e.target.value)}
            placeholder="0,00"
          />
        </Field>

        <Field label="Vencimento / data prevista" htmlFor="tx-due" error={errors.dueDate}>
          <input
            id="tx-due"
            type="date"
            className="input"
            value={form.dueDate}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                dueDate: e.target.value,
                competenceDate: f.competenceTouched || !e.target.value ? f.competenceDate : e.target.value,
              }))
            }
          />
        </Field>

        {!lockedFinancials && (
          <div className="col-span-2">
            <span className="label">Situação</span>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Situação">
              {(
                [
                  ['forecast', 'Prevista', 'Ainda incerta'],
                  ['pending', 'Pendente', 'Confirmada, a pagar'],
                  ['settled', isExpense ? 'Já paga' : 'Já recebida', 'Dinheiro já movimentado'],
                ] as const
              )
                .filter(([s]) => mode !== 'edit' || s !== 'settled')
                .map(([s, label, desc]) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={form.situation === s}
                    onClick={() => set('situation', s)}
                    className={`rounded-xl border px-3 py-2.5 text-left text-xs transition ${
                      form.situation === s ? 'border-accent bg-accent/10 ring-4 ring-accent/10' : 'border-line hover:border-muted/40'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="text-muted">{desc}</span>
                  </button>
                ))}
            </div>
            {mode === 'edit' && (
              <p className="mt-1 text-xs text-muted">Para registrar o pagamento use “{isExpense ? 'Pagar' : 'Receber'}” no lançamento.</p>
            )}
          </div>
        )}

        <Field
          label={form.situation === 'settled' ? 'Conta utilizada' : 'Conta (opcional)'}
          htmlFor="tx-account"
          error={errors.accountId}
          className="col-span-2 sm:col-span-1"
        >
          <select
            id="tx-account"
            className="input"
            value={form.accountId}
            disabled={lockedFinancials}
            onChange={(e) => set('accountId', e.target.value)}
          >
            <option value="">Sem conta definida</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.account_type === 'benefit' ? ` — ${ACCOUNT_TYPE_LABEL.benefit}` : ''}
                {!a.is_active ? ' (desativada)' : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Categoria (opcional)" htmlFor="tx-cat" className="col-span-2 sm:col-span-1">
          <select id="tx-cat" className="input" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">Sem categoria</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        {form.situation === 'settled' && !lockedFinancials && (
          <>
            <Field label={isExpense ? 'Data do pagamento' : 'Data do recebimento'} htmlFor="tx-settled" error={errors.settledAt}>
              <input
                id="tx-settled"
                type="date"
                className="input"
                max={today}
                value={form.settledAt}
                onChange={(e) => set('settledAt', e.target.value)}
              />
            </Field>
            <Field
              label={isExpense ? 'Valor pago (R$)' : 'Valor recebido (R$)'}
              htmlFor="tx-settled-amount"
              error={errors.settledAmount}
              hint="Em branco = mesmo valor"
            >
              <input
                id="tx-settled-amount"
                className="input tabular"
                inputMode="decimal"
                value={form.settledAmount}
                onChange={(e) => set('settledAmount', e.target.value)}
                placeholder={form.amount || '0,00'}
              />
            </Field>
          </>
        )}

        <div className="col-span-2">
          <button type="button" className="text-xs font-medium text-accent" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>
            {showMore ? 'Ocultar detalhes' : 'Mais detalhes (competência, forma de pagamento, etiquetas, observações)'}
          </button>
        </div>

        {showMore && (
          <>
            <Field
              label="Competência"
              htmlFor="tx-comp"
              error={errors.competenceDate}
              hint="Mês/dia a que o gasto pertence"
            >
              <input
                id="tx-comp"
                type="date"
                className="input"
                value={form.competenceDate}
                onChange={(e) => setForm((f) => ({ ...f, competenceDate: e.target.value, competenceTouched: true }))}
              />
            </Field>
            <Field label="Forma de pagamento" htmlFor="tx-method">
              <select
                id="tx-method"
                className="input"
                value={form.paymentMethod}
                onChange={(e) => set('paymentMethod', e.target.value as PaymentMethod | '')}
              >
                <option value="">Não informada</option>
                {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Etiquetas" htmlFor="tx-tags" error={errors.tags} hint="Separadas por vírgula" className="col-span-2">
              <input id="tx-tags" className="input" value={form.tags} onChange={(e) => set('tags', e.target.value)} />
            </Field>
            <Field label="Observações" htmlFor="tx-notes" error={errors.notes} className="col-span-2">
              <textarea
                id="tx-notes"
                className="input min-h-[72px]"
                maxLength={1000}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}

export function buildCategoryOptions(categories: Category[], type: 'income' | 'expense' | null, selectedId?: string) {
  const usable = (c: Category) =>
    (c.is_active || c.id === selectedId) && (type === null || c.category_type === 'both' || c.category_type === type);
  const parents = categories.filter((c) => !c.parent_id && usable(c));
  const out: { id: string; label: string }[] = [];
  for (const p of parents) {
    out.push({ id: p.id, label: p.name + (p.is_active ? '' : ' (desativada)') });
    for (const child of categories.filter((c) => c.parent_id === p.id && usable(c))) {
      out.push({ id: child.id, label: `  ↳ ${child.name}${child.is_active ? '' : ' (desativada)'}` });
    }
  }
  return out;
}
