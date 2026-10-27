/**
 * Regras de apresentação, sugestão de ordem e simulação de pagamentos.
 * Tudo aqui é puro (sem rede) e nunca altera saldos: a simulação só vira
 * movimento real quando o usuário confirma um pagamento (RPC pay_debt).
 */
import { diffDays } from '@/lib/dates';
import type { Debt, DebtBalance, LateConsequence, PriorityLevel } from '@/lib/types';

export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

export const CONSEQUENCE_LABEL: Record<LateConsequence, string> = {
  service_cut: 'Corte de serviço essencial',
  asset_loss: 'Perda de bem ou moradia',
  personal_trust: 'Dívida com pessoa (não pode atrasar)',
  legal_action: 'Cobrança judicial',
  credit_restriction: 'Nome negativado',
  high_interest: 'Juros altos',
  other: 'Outra consequência',
  none: 'Sem consequência grave',
};

export interface DebtView extends Debt {
  balance: DebtBalance;
  outstanding: number;
  /** Valor devido no próximo vencimento: parcela, senão mínimo, senão o saldo. */
  amountDue: number;
  /** Dias de atraso (> 0) ou null quando não está vencida. */
  daysOverdue: number | null;
  /** Dias até o vencimento (>= 0) ou null quando não há data / já venceu. */
  daysToDue: number | null;
}

const EMPTY_BALANCE = (d: Debt): DebtBalance => ({
  debt_id: d.id,
  original_amount_cents: d.original_amount_cents,
  principal_paid_cents: 0,
  charges_paid_cents: 0,
  total_paid_cents: 0,
  charges_added_cents: 0,
  discounts_cents: 0,
  principal_outstanding_cents: d.original_amount_cents,
  charges_outstanding_cents: 0,
  outstanding_cents: d.original_amount_cents,
  last_payment_at: null,
  payments_count: 0,
});

export function amountDue(d: Pick<Debt, 'installment_amount_cents' | 'minimum_payment_cents'>, outstanding: number): number {
  return Math.min(outstanding, d.installment_amount_cents ?? d.minimum_payment_cents ?? outstanding);
}

export function buildDebtView(debt: Debt, balance: DebtBalance | undefined, today: string): DebtView {
  const b = balance ?? EMPTY_BALANCE(debt);
  const outstanding = Number(b.outstanding_cents);
  const delta = debt.next_due_date ? diffDays(debt.next_due_date, today) : null;
  const active = debt.debt_status === 'active' && outstanding > 0;
  return {
    ...debt,
    balance: b,
    outstanding,
    amountDue: amountDue(debt, outstanding),
    daysOverdue: active && delta !== null && delta < 0 ? -delta : null,
    daysToDue: active && delta !== null && delta >= 0 ? delta : null,
  };
}

// -----------------------------------------------------------------------------
// Ordem sugerida
// -----------------------------------------------------------------------------

export interface Suggestion {
  debt: DebtView;
  score: number;
  reasons: string[];
}

const CONSEQUENCE_WEIGHT: Record<LateConsequence, number> = {
  service_cut: 40,
  asset_loss: 36,
  personal_trust: 34,
  legal_action: 26,
  credit_restriction: 16,
  high_interest: 10,
  other: 6,
  none: 0,
};

const LEVEL_WEIGHT: Record<PriorityLevel, number> = { critical: 30, high: 15, medium: 0, low: -10 };

function pct(n: number) {
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% a.m.`;
}

/**
 * Pontua cada dívida por essencialidade, consequência do atraso, vencimento,
 * juros, prioridade informada e capacidade de pagamento. Não altera a ordem
 * manual: o usuário decide se quer adotá-la.
 */
export function suggestOrder(debts: DebtView[], available: number): Suggestion[] {
  const scored = debts
    .filter((d) => d.debt_status === 'active' && d.outstanding > 0)
    .map((d) => {
      const parts: { w: number; text: string }[] = [];
      if (d.is_essential) parts.push({ w: 25, text: 'conta essencial' });
      const cw = CONSEQUENCE_WEIGHT[d.late_consequence];
      if (cw > 0) parts.push({ w: cw, text: CONSEQUENCE_LABEL[d.late_consequence].toLowerCase() });
      if (d.daysOverdue !== null) {
        parts.push({ w: 20 + Math.min(15, d.daysOverdue / 2), text: `vencida há ${d.daysOverdue} dia(s)` });
      } else if (d.daysToDue !== null && d.daysToDue <= 7) {
        parts.push({ w: 12, text: d.daysToDue === 0 ? 'vence hoje' : `vence em ${d.daysToDue} dia(s)` });
      } else if (d.daysToDue !== null && d.daysToDue <= 15) {
        parts.push({ w: 6, text: `vence em ${d.daysToDue} dias` });
      }
      const rate = d.interest_rate_monthly === null ? null : Number(d.interest_rate_monthly);
      if (rate !== null && rate > 0) parts.push({ w: Math.min(20, rate * 2), text: `juros de ${pct(rate)}` });
      const lw = LEVEL_WEIGHT[d.priority_level];
      if (lw !== 0) parts.push({ w: lw, text: `prioridade ${PRIORITY_LABEL[d.priority_level].toLowerCase()}` });
      if (available > 0 && d.outstanding <= available * 0.1) {
        parts.push({ w: 4, text: 'quitação rápida com pouco dinheiro' });
      } else if (available > 0 && d.amountDue <= available) {
        parts.push({ w: 3, text: 'cabe no dinheiro disponível' });
      }
      const score = Math.round(parts.reduce((s, p) => s + p.w, 0) * 10) / 10;
      const reasons = parts
        .filter((p) => p.w > 0)
        .sort((a, b) => b.w - a.w)
        .slice(0, 3)
        .map((p) => p.text);
      return { debt: d, score, reasons: reasons.length ? reasons : ['sem urgência identificada'] };
    });

  return scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.debt.next_due_date ?? '9999').localeCompare(b.debt.next_due_date ?? '9999') ||
      Number(b.debt.interest_rate_monthly ?? 0) - Number(a.debt.interest_rate_monthly ?? 0) ||
      a.debt.priority_rank - b.debt.priority_rank,
  );
}

// -----------------------------------------------------------------------------
// Simulação
// -----------------------------------------------------------------------------

export type PlanChoice = 'due' | 'minimum' | 'full' | 'custom' | 'skip';

export interface PlanItem {
  choice: PlanChoice;
  customCents?: number;
}

export function plannedAmount(d: DebtView, item: PlanItem): number {
  switch (item.choice) {
    case 'skip':
      return 0;
    case 'full':
      return d.outstanding;
    case 'minimum':
      return Math.min(d.outstanding, d.minimum_payment_cents ?? d.amountDue);
    case 'custom':
      return Math.max(0, Math.min(d.outstanding, item.customCents ?? 0));
    case 'due':
    default:
      return d.amountDue;
  }
}

export type SimStatus = 'covered' | 'partial' | 'uncovered' | 'skipped';

export interface SimRow {
  debt: DebtView;
  planned: number;
  paid: number;
  status: SimStatus;
  balanceAfter: number;
  outstandingAfter: number;
}

export interface SimResult {
  rows: SimRow[];
  available: number;
  totalPlanned: number;
  totalPaid: number;
  /** Quanto falta para cobrir tudo o que foi planejado (0 se sobra dinheiro). */
  shortfall: number;
  remaining: number;
}

/**
 * Percorre as dívidas na ordem dada, pagando enquanto houver dinheiro.
 * Sem pagamento parcial, uma conta que não cabe é pulada e as seguintes ainda
 * podem ser cobertas; com pagamento parcial, o restante é aplicado a ela.
 */
export function simulate(
  ordered: DebtView[],
  available: number,
  plan: Record<string, PlanItem>,
  allowPartial = false,
): SimResult {
  let remaining = Math.max(0, available);
  let totalPlanned = 0;
  let totalPaid = 0;
  const rows: SimRow[] = ordered.map((debt) => {
    const item = plan[debt.id] ?? { choice: 'due' };
    const planned = plannedAmount(debt, item);
    totalPlanned += planned;
    let paid = 0;
    let status: SimStatus;
    if (planned === 0) {
      status = 'skipped';
    } else if (planned <= remaining) {
      paid = planned;
      status = 'covered';
    } else if (allowPartial && remaining > 0) {
      paid = remaining;
      status = 'partial';
    } else {
      status = 'uncovered';
    }
    remaining -= paid;
    totalPaid += paid;
    return { debt, planned, paid, status, balanceAfter: remaining, outstandingAfter: debt.outstanding - paid };
  });
  return {
    rows,
    available: Math.max(0, available),
    totalPlanned,
    totalPaid,
    shortfall: Math.max(0, totalPlanned - Math.max(0, available)),
    remaining,
  };
}

/** Move um item da lista (usado por arrastar-e-soltar e pelos botões subir/descer). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const copy = list.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
