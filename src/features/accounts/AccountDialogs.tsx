import { useEffect, useState } from 'react';
import { Field, FormError, Modal, Money, Toggle, useToast } from '@/components/ui';
import { useAccounts, useAdjustBalance, useSaveAccount, useTransfer, type AccountInput } from '@/hooks/data';
import { useToday } from '@/hooks/useToday';
import { centsToInput, parseMoneyToCents } from '@/lib/money';
import { friendlyError } from '@/lib/errors';
import { isValidISODate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { ACCOUNT_TYPE_LABEL } from '@/lib/labels';
import type { Account, AccountBalance, AccountType } from '@/lib/types';

export function AccountForm({
  open,
  onClose,
  account,
  hasMovements,
}: {
  open: boolean;
  onClose: () => void;
  account?: Account;
  hasMovements: boolean;
}) {
  const today = useToday();
  const save = useSaveAccount();
  const toast = useToast();
  const [id, setId] = useState(newId);
  const [form, setForm] = useState({
    name: '',
    institution: '',
    type: 'checking' as AccountType,
    opening: '',
    openingDate: today,
    color: '#F88F22',
    active: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setId(account?.id ?? newId());
    setErrors({});
    save.reset();
    setForm({
      name: account?.name ?? '',
      institution: account?.institution_name ?? '',
      type: account?.account_type ?? 'checking',
      opening: account ? centsToInput(account.opening_balance_cents) : '',
      openingDate: account?.opening_date ?? today,
      color: account?.color ?? '#F88F22',
      active: account?.is_active ?? true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const locked = !!account && hasMovements;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const opening = form.opening.trim() ? parseMoneyToCents(form.opening) : 0;
    if (!form.name.trim()) errs.name = 'Informe o nome.';
    if (opening === null) errs.opening = 'Valor inválido.';
    if (!isValidISODate(form.openingDate)) errs.openingDate = 'Data inválida.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const input: AccountInput = {
      name: form.name.trim(),
      institution_name: form.institution.trim() || null,
      account_type: form.type,
      opening_balance_cents: opening!,
      opening_date: form.openingDate,
      color: form.color,
      is_active: form.active,
    };
    save.mutate(
      { id, existing: account, input },
      {
        onSuccess: () => {
          toast(account ? 'Conta atualizada.' : 'Conta cadastrada.');
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={account ? 'Editar conta' : 'Nova conta'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={save.isPending}>Cancelar</button>
          <button type="submit" form="acc-form" className="btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="acc-form" onSubmit={submit} noValidate className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <FormError message={save.error ? friendlyError(save.error) : null} />
        </div>
        <Field label="Nome" htmlFor="acc-name" error={errors.name} className="col-span-2">
          <input id="acc-name" className="input" maxLength={80} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Conta salário" />
        </Field>
        <Field label="Instituição" htmlFor="acc-inst" className="col-span-2 sm:col-span-1">
          <input id="acc-inst" className="input" maxLength={80} value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
        </Field>
        <Field
          label="Tipo"
          htmlFor="acc-type"
          className="col-span-2 sm:col-span-1"
          hint={form.type === 'benefit' ? 'Saldo controlado à parte; não entra no dinheiro livre.' : undefined}
        >
          <select id="acc-type" className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}>
            {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k} disabled={locked && (k === 'benefit') !== (account!.account_type === 'benefit')}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Saldo inicial (R$)"
          htmlFor="acc-opening"
          error={errors.opening}
          hint={locked ? 'Já há lançamentos: use “Ajustar saldo”.' : 'Saldo real da conta na data abaixo. Pode ser negativo.'}
        >
          <input id="acc-opening" className="input tabular" inputMode="decimal" disabled={locked} value={form.opening} onChange={(e) => setForm({ ...form, opening: e.target.value })} placeholder="0,00" />
        </Field>
        <Field label="Saldo em" htmlFor="acc-date" error={errors.openingDate} hint={locked ? undefined : 'Movimentos anteriores já estão no saldo inicial.'}>
          <input id="acc-date" type="date" className="input" disabled={locked} value={form.openingDate} onChange={(e) => setForm({ ...form, openingDate: e.target.value })} />
        </Field>
        <Field label="Cor" htmlFor="acc-color">
          <input id="acc-color" type="color" className="h-10 w-16 rounded border border-line bg-surface-2" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
        </Field>
        {account && (
          <div className="col-span-2">
            <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Conta ativa" description="Contas desativadas não aparecem nos totais nem nos formulários." />
          </div>
        )}
      </form>
    </Modal>
  );
}

export function TransferDialog({ open, onClose, fromId }: { open: boolean; onClose: () => void; fromId?: string }) {
  const today = useToday();
  const accounts = (useAccounts().data ?? []).filter((a) => a.is_active);
  const transfer = useTransfer();
  const toast = useToast();
  const [key, setKey] = useState(newId);
  const [form, setForm] = useState({ from: '', to: '', amount: '', date: today, description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setKey(newId());
    setErrors({});
    transfer.reset();
    setForm({ from: fromId ?? accounts[0]?.id ?? '', to: '', amount: '', date: today, description: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const cents = parseMoneyToCents(form.amount);
    if (!form.from) errs.from = 'Escolha a conta de origem.';
    if (!form.to || form.to === form.from) errs.to = 'Escolha uma conta de destino diferente.';
    if (cents === null || cents <= 0) errs.amount = 'Informe um valor maior que zero.';
    if (!isValidISODate(form.date)) errs.date = 'Data inválida.';
    else if (form.date > today) errs.date = 'A data não pode estar no futuro.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    transfer.mutate(
      { from: form.from, to: form.to, amount_cents: cents!, date: form.date, description: form.description, key },
      {
        onSuccess: () => {
          toast('Transferência registrada.');
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Transferência entre contas"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={transfer.isPending}>Cancelar</button>
          <button type="submit" form="tr-form" className="btn-primary" disabled={transfer.isPending}>
            {transfer.isPending ? 'Transferindo…' : 'Transferir'}
          </button>
        </>
      }
    >
      <form id="tr-form" onSubmit={submit} noValidate className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <FormError message={transfer.error ? friendlyError(transfer.error) : null} />
          <p className="text-xs text-muted">Transferências entre contas próprias não contam como receita nem despesa.</p>
        </div>
        <Field label="De" htmlFor="tr-from" error={errors.from}>
          <select id="tr-from" className="input" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>
            <option value="">Selecione…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Para" htmlFor="tr-to" error={errors.to}>
          <select id="tr-to" className="input" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>
            <option value="">Selecione…</option>
            {accounts.filter((a) => a.id !== form.from).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Valor (R$)" htmlFor="tr-amount" error={errors.amount}>
          <input id="tr-amount" className="input tabular" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0,00" />
        </Field>
        <Field label="Data" htmlFor="tr-date" error={errors.date}>
          <input id="tr-date" type="date" className="input" max={today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Descrição (opcional)" htmlFor="tr-desc" className="col-span-2">
          <input id="tr-desc" className="input" maxLength={140} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Transferência" />
        </Field>
      </form>
    </Modal>
  );
}

export function AdjustDialog({ balance, onClose }: { balance: AccountBalance | null; onClose: () => void }) {
  const today = useToday();
  const adjust = useAdjustBalance();
  const toast = useToast();
  const [key, setKey] = useState(newId);
  const [target, setTarget] = useState('');
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!balance) return;
    setKey(newId());
    setTarget(centsToInput(balance.balance_cents));
    setDate(today);
    setReason('');
    setError(null);
    adjust.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance?.account_id]);

  const targetCents = parseMoneyToCents(target);
  const diff = balance && targetCents !== null ? targetCents - Number(balance.balance_cents) : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (targetCents === null) return setError('Informe o saldo real.');
    if (!isValidISODate(date) || date > today) return setError('Data inválida.');
    if (diff === 0) return setError('O saldo informado é igual ao atual.');
    setError(null);
    adjust.mutate(
      { account_id: balance!.account_id, target_cents: targetCents, date, reason, key },
      {
        onSuccess: () => {
          toast('Saldo ajustado.');
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      open={!!balance}
      onClose={onClose}
      title={`Ajustar saldo — ${balance?.name ?? ''}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={adjust.isPending}>Cancelar</button>
          <button type="submit" form="adj-form" className="btn-primary" disabled={adjust.isPending}>
            {adjust.isPending ? 'Ajustando…' : 'Registrar ajuste'}
          </button>
        </>
      }
    >
      {balance && (
        <form id="adj-form" onSubmit={submit} noValidate className="grid gap-3">
          <FormError message={error ?? (adjust.error ? friendlyError(adjust.error) : null)} />
          <p className="text-sm text-muted">
            Use quando o saldo do aplicativo divergir do banco por movimentos não registrados. Será criado um lançamento de
            ajuste rastreável; ele não conta como receita nem despesa. Prefira registrar os lançamentos que faltam.
          </p>
          <p className="text-sm">
            Saldo calculado: <Money cents={balance.balance_cents} className="font-semibold" />
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Saldo real hoje (R$)" htmlFor="adj-target">
              <input id="adj-target" className="input tabular" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
            </Field>
            <Field label="Data" htmlFor="adj-date">
              <input id="adj-date" type="date" className="input" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          {diff !== null && diff !== 0 && (
            <p className="text-sm">
              Diferença: <Money cents={diff} signed className={diff < 0 ? 'text-expense' : 'text-income'} />
            </p>
          )}
          <Field label="Motivo" htmlFor="adj-reason">
            <input id="adj-reason" className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: tarifa bancária não registrada" />
          </Field>
        </form>
      )}
    </Modal>
  );
}
