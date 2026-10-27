import type { AccountType, PaymentMethod, Transaction, TransactionStatus, TransactionType } from './types';

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  cash: 'Dinheiro em espécie',
  investment: 'Investimento (liquidez)',
  benefit: 'Benefício (uso restrito)',
  other: 'Outra',
};

export const TYPE_LABEL: Record<TransactionType, string> = {
  income: 'Receita',
  expense: 'Despesa',
  transfer: 'Transferência',
  adjustment: 'Ajuste de saldo',
  reversal: 'Estorno',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix',
  debit: 'Débito',
  credit: 'Crédito',
  cash: 'Dinheiro',
  boleto: 'Boleto',
  transfer: 'Transferência',
  auto_debit: 'Débito automático',
  benefit_card: 'Cartão benefício',
  other: 'Outro',
};

export type DisplayStatus = TransactionStatus | 'overdue';

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  forecast: 'Previsto',
  pending: 'Pendente',
  paid: 'Pago',
  received: 'Recebido',
  canceled: 'Cancelado',
  overdue: 'Vencido',
};

export function isOpen(t: Pick<Transaction, 'status'>): boolean {
  return t.status === 'forecast' || t.status === 'pending';
}

export function isSettled(t: Pick<Transaction, 'status'>): boolean {
  return t.status === 'paid' || t.status === 'received';
}

/** "Vencido" é derivado: em aberto e com data de referência anterior a hoje. */
export function displayStatus(t: Pick<Transaction, 'status' | 'ref_date'>, today: string): DisplayStatus {
  if (isOpen(t) && t.ref_date < today) return 'overdue';
  return t.status;
}

/** Classe de cor por natureza e estado (efetivo = neon, previsto = suave). */
export function amountColor(t: Pick<Transaction, 'direction' | 'status' | 'transaction_type'>): string {
  if (t.status === 'canceled') return 'text-muted line-through';
  if (t.transaction_type === 'transfer' || t.transaction_type === 'adjustment' || t.transaction_type === 'reversal') {
    return 'text-fg';
  }
  const settled = t.status === 'paid' || t.status === 'received';
  if (t.direction === 'out') return settled || t.status === 'pending' ? 'text-expense' : 'text-expense-forecast';
  return settled ? 'text-income' : 'text-income-forecast';
}
