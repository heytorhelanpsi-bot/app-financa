import { describe, expect, it } from 'vitest';
import type { Debt } from '@/lib/types';
import { buildDebtView, moveItem, plannedAmount, simulate, suggestOrder, type DebtView } from './logic';

const TODAY = '2026-10-27';

function debt(over: Partial<Debt> & { id: string }, outstanding = over.original_amount_cents ?? 100000): DebtView {
  const d: Debt = {
    user_id: 'u',
    creditor_name: over.id,
    description: null,
    original_amount_cents: 100000,
    contracted_amount_cents: null,
    minimum_payment_cents: null,
    installment_amount_cents: null,
    installments_total: null,
    next_due_date: null,
    interest_rate_monthly: null,
    late_fee_percent: null,
    category_id: null,
    account_id: null,
    priority_level: 'medium',
    priority_rank: 1,
    is_essential: false,
    late_consequence: 'none',
    consequence_notes: null,
    debt_status: 'active',
    notes: null,
    version: 1,
    created_at: '',
    ...over,
  };
  return buildDebtView(
    d,
    {
      debt_id: d.id,
      original_amount_cents: d.original_amount_cents,
      principal_paid_cents: d.original_amount_cents - outstanding,
      charges_paid_cents: 0,
      total_paid_cents: 0,
      charges_added_cents: 0,
      discounts_cents: 0,
      principal_outstanding_cents: outstanding,
      charges_outstanding_cents: 0,
      outstanding_cents: outstanding,
      last_payment_at: null,
      payments_count: 0,
    },
    TODAY,
  );
}

describe('buildDebtView', () => {
  it('calcula valor devido, atraso e dias até o vencimento', () => {
    const late = debt({ id: 'a', installment_amount_cents: 30000, next_due_date: '2026-10-20' });
    expect(late.amountDue).toBe(30000);
    expect(late.daysOverdue).toBe(7);
    expect(late.daysToDue).toBeNull();
    const soon = debt({ id: 'b', minimum_payment_cents: 5000, next_due_date: '2026-10-30' });
    expect(soon.amountDue).toBe(5000);
    expect(soon.daysToDue).toBe(3);
    const small = debt({ id: 'c', installment_amount_cents: 30000 }, 10000);
    expect(small.amountDue).toBe(10000);
  });

  it('dívida quitada não fica vencida', () => {
    const paid = debt({ id: 'p', next_due_date: '2026-10-01', debt_status: 'paid_off' }, 0);
    expect(paid.daysOverdue).toBeNull();
  });
});

describe('suggestOrder', () => {
  it('prioriza serviço essencial vencido sobre cartão com juros e explica o motivo', () => {
    const luz = debt({ id: 'luz', is_essential: true, late_consequence: 'service_cut', next_due_date: '2026-10-25' });
    const cartao = debt({ id: 'cartao', interest_rate_monthly: 12, late_consequence: 'high_interest', next_due_date: '2026-11-10' });
    const amigo = debt({ id: 'amigo', priority_level: 'low' });
    const s = suggestOrder([amigo, cartao, luz], 50000);
    expect(s.map((x) => x.debt.id)).toEqual(['luz', 'cartao', 'amigo']);
    expect(s[0].reasons.join(' ')).toMatch(/corte de serviço essencial/);
    expect(s[0].reasons.join(' ')).toMatch(/vencida há 2/);
    expect(s[1].reasons.join(' ')).toMatch(/juros de 12% a.m./);
  });

  it('ignora dívidas quitadas e arquivadas', () => {
    const s = suggestOrder([debt({ id: 'x', debt_status: 'archived' }), debt({ id: 'y' }, 0)], 1000);
    expect(s).toHaveLength(0);
  });
});

describe('simulate', () => {
  const a = debt({ id: 'a', installment_amount_cents: 60000 });
  const b = debt({ id: 'b', installment_amount_cents: 50000 });
  const c = debt({ id: 'c', installment_amount_cents: 20000 });

  it('mostra disponível, total, diferença, cobertas, pendentes e saldo após cada pagamento', () => {
    const r = simulate([a, b, c], 90000, {});
    expect(r.totalPlanned).toBe(130000);
    expect(r.shortfall).toBe(40000);
    expect(r.rows.map((x) => x.status)).toEqual(['covered', 'uncovered', 'covered']);
    expect(r.rows.map((x) => x.balanceAfter)).toEqual([30000, 30000, 10000]);
    expect(r.remaining).toBe(10000);
  });

  it('com pagamento parcial aplica o que sobra', () => {
    const r = simulate([a, b, c], 90000, {}, true);
    expect(r.rows.map((x) => [x.status, x.paid])).toEqual([
      ['covered', 60000],
      ['partial', 30000],
      ['uncovered', 0],
    ]);
  });

  it('respeita escolhas: quitar, pular e valor personalizado', () => {
    const r = simulate([a, b, c], 1_000_000, {
      a: { choice: 'full' },
      b: { choice: 'skip' },
      c: { choice: 'custom', customCents: 999_999_999 },
    });
    expect(r.rows.map((x) => x.paid)).toEqual([100000, 0, 100000]);
    expect(r.rows[1].status).toBe('skipped');
    expect(plannedAmount(c, { choice: 'custom', customCents: 1234 })).toBe(1234);
  });

  it('não altera os objetos de entrada (simulação não mexe em saldos reais)', () => {
    const before = JSON.stringify([a, b, c]);
    simulate([a, b, c], 10, {});
    expect(JSON.stringify([a, b, c])).toBe(before);
  });
});

describe('moveItem', () => {
  it('reordena sem mutar a lista original', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
    expect(moveItem(list, 1, 9)).toBe(list);
  });
});
