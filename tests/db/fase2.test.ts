import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceOf, createAccount, createTestDb, createUser, userQuery, uuid, type TestDb } from './helpers';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db?.drop();
});

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const dt = new Date(`${d}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

async function createDebt(userId: string, fields: Record<string, unknown> = {}): Promise<any> {
  const base: Record<string, unknown> = { creditor_name: 'Banco X', original_amount_cents: 200000, ...fields };
  const cols = Object.keys(base);
  const rows = await userQuery(
    db,
    userId,
    `insert into public.debts (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    cols.map((c) => base[c]),
  );
  return rows[0];
}

async function debtBalance(userId: string, debtId: string) {
  const rows = await userQuery(db, userId, 'select * from public.debt_balances where debt_id = $1', [debtId]);
  return rows[0];
}

function payDebt(
  userId: string,
  debtId: string,
  accountId: string,
  principal: number,
  charges = 0,
  key = uuid(),
  advance = false,
) {
  return userQuery(db, userId, 'select public.pay_debt($1, $2, $3, $4, $5, $6, null, $7) as r', [
    debtId,
    accountId,
    today(),
    principal,
    charges,
    advance,
    key,
  ]).then((r) => r[0].r);
}

describe('Teste D — pagamento parcial de dívida', () => {
  it('dívida de R$ 2.000 com pagamento de R$ 500 ao principal passa a R$ 1.500', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 400000 });
    const debt = await createDebt(u, { original_amount_cents: 200000 });

    const r = await payDebt(u, debt.id, acc, 50000);
    expect(r.paid_off).toBe(false);

    const b = await debtBalance(u, debt.id);
    expect(Number(b.outstanding_cents)).toBe(150000);
    expect(Number(b.principal_paid_cents)).toBe(50000);
    expect(await balanceOf(db, u, acc)).toBe(350000);

    const hist = await userQuery(db, u, 'select * from public.debt_payments where debt_id = $1', [debt.id]);
    expect(hist).toHaveLength(1);
    const [tx] = await userQuery(db, u, 'select * from public.transactions where id = $1', [hist[0].transaction_id]);
    expect(tx.status).toBe('paid');
    expect(Number(tx.settled_amount_cents)).toBe(50000);
  });

  it('juros e encargos são separados do principal', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 400000 });
    const debt = await createDebt(u, { original_amount_cents: 100000 });
    await userQuery(db, u, "select public.add_debt_charge($1, 'interest', 3000, $2, 'juros do mês', $3)", [
      debt.id,
      today(),
      uuid(),
    ]);
    let b = await debtBalance(u, debt.id);
    expect(Number(b.outstanding_cents)).toBe(103000);

    await payDebt(u, debt.id, acc, 20000, 3000);
    b = await debtBalance(u, debt.id);
    expect(Number(b.principal_outstanding_cents)).toBe(80000);
    expect(Number(b.charges_outstanding_cents)).toBe(0);
    expect(await balanceOf(db, u, acc)).toBe(400000 - 23000);
  });

  it('não aceita principal maior que o principal em aberto', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 400000 });
    const debt = await createDebt(u, { original_amount_cents: 10000 });
    await expect(payDebt(u, debt.id, acc, 10001)).rejects.toThrow(/excede o principal/);
    expect(await balanceOf(db, u, acc)).toBe(400000);
  });

  it('quitação total marca a dívida como quitada e avança o vencimento só se houver saldo', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 400000 });
    const due = today();
    const debt = await createDebt(u, { original_amount_cents: 30000, installment_amount_cents: 10000, next_due_date: due });
    await payDebt(u, debt.id, acc, 10000, 0, uuid(), true);
    let [d] = await userQuery(db, u, 'select * from public.debts where id = $1', [debt.id]);
    expect(d.debt_status).toBe('active');
    expect(d.next_due_date).not.toEqual(debt.next_due_date);

    const r = await payDebt(u, debt.id, acc, 20000);
    expect(r.paid_off).toBe(true);
    [d] = await userQuery(db, u, 'select * from public.debts where id = $1', [debt.id]);
    expect(d.debt_status).toBe('paid_off');
    await expect(payDebt(u, debt.id, acc, 100)).rejects.toThrow(/não está ativa/);
  });
});

describe('Integridade das dívidas', () => {
  it('saldo devedor não pode ser editado nem o histórico alterado diretamente', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 100000 });
    const debt = await createDebt(u);
    await payDebt(u, debt.id, acc, 1000);

    await expect(
      userQuery(db, u, 'update public.debts set original_amount_cents = 1 where id = $1', [debt.id]),
    ).rejects.toThrow(/valor original não pode ser alterado/);
    await expect(
      userQuery(db, u, 'update public.debt_payments set principal_cents = 0, amount_cents = 0 where debt_id = $1', [debt.id]),
    ).rejects.toThrow(/operações próprias/);
    await expect(
      userQuery(db, u, 'insert into public.debt_payments (debt_id, transaction_id, amount_cents, principal_cents, charges_cents, payment_date) select $1, id, 1, 1, 0, current_date from public.transactions limit 1', [debt.id]),
    ).rejects.toThrow(/operações próprias/);
    await expect(userQuery(db, u, 'delete from public.debts where id = $1', [debt.id])).rejects.toThrow(/não pode ser excluída/);
    await expect(
      userQuery(db, u, "update public.debts set debt_status = 'paid_off' where id = $1", [debt.id]),
    ).rejects.toThrow(/saldo devedor chega a zero/);
    // Campos descritivos e prioridade continuam editáveis; arquivar é permitido.
    await userQuery(db, u, "update public.debts set priority_level = 'critical', debt_status = 'archived' where id = $1", [debt.id]);
  });

  it('estornar o pagamento anula o abatimento, reabre a dívida e não cria despesa avulsa', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 100000 });
    const debt = await createDebt(u, { original_amount_cents: 5000 });
    const r = await payDebt(u, debt.id, acc, 5000);
    expect(r.paid_off).toBe(true);

    const rev = await userQuery(db, u, 'select public.reverse_transaction($1, $2, true, $3) as r', [
      r.transaction_id,
      'erro',
      uuid(),
    ]);
    expect(rev[0].r.reopened_id).toBeNull();
    expect(rev[0].r.debt_payment_reversed).toBe(true);

    const b = await debtBalance(u, debt.id);
    expect(Number(b.outstanding_cents)).toBe(5000);
    const [d] = await userQuery(db, u, 'select debt_status from public.debts where id = $1', [debt.id]);
    expect(d.debt_status).toBe('active');
    expect(await balanceOf(db, u, acc)).toBe(100000);
    const pending = await userQuery(db, u, "select * from public.transactions where status = 'pending'");
    expect(pending).toHaveLength(0);
  });

  it('ordem manual é preservada e salva de forma atômica', async () => {
    const u = await createUser(db);
    const a = await createDebt(u, { creditor_name: 'A' });
    const b = await createDebt(u, { creditor_name: 'B' });
    const c = await createDebt(u, { creditor_name: 'C' });
    expect([a.priority_rank, b.priority_rank, c.priority_rank]).toEqual([1, 2, 3]);
    await userQuery(db, u, 'select public.reorder_debts($1)', [[c.id, a.id, b.id]]);
    const rows = await userQuery(db, u, 'select creditor_name from public.debts order by priority_rank');
    expect(rows.map((r) => r.creditor_name)).toEqual(['C', 'A', 'B']);
    await expect(userQuery(db, u, 'select public.reorder_debts($1)', [[c.id, c.id]])).rejects.toThrow(/repetidos/);
  });
});

describe('Resumo e projeção com dívidas', () => {
  it('parcela a vencer entra no comprometido e na projeção, sem afetar o saldo bancário', async () => {
    const u = await createUser(db);
    await createAccount(db, u, { opening: 300000 });
    await createDebt(u, {
      original_amount_cents: 120000,
      installment_amount_cents: 40000,
      next_due_date: addDays(today(), 3),
    });
    const [{ s }] = await userQuery(db, u, 'select public.financial_summary($1, $2) as s', [today(), addDays(today(), 10)]);
    expect(Number(s.bank_balance_cents)).toBe(300000);
    expect(Number(s.debts.due_cents)).toBe(40000);
    expect(Number(s.committed_cents)).toBe(40000);
    expect(Number(s.free_cents)).toBe(260000);

    const proj = await userQuery(db, u, 'select * from public.balance_projection($1)', [addDays(today(), 10)]);
    expect(proj).toHaveLength(11);
    expect(Number(proj[0].balance_cents)).toBe(300000);
    expect(Number(proj[3].outflow_cents)).toBe(40000);
    expect(Number(proj[10].balance_cents)).toBe(260000);

    const [{ s: semDividas }] = await userQuery(
      db,
      u,
      'select public.financial_summary($1, $2, null, true, false, false, false) as s',
      [today(), addDays(today(), 10)],
    );
    expect(Number(semDividas.committed_cents)).toBe(0);
  });

  it('projeção traz vencidos para hoje e marca receitas incertas', async () => {
    const u = await createUser(db);
    await createAccount(db, u, { opening: 10000 });
    await userQuery(
      db,
      u,
      "insert into public.transactions (description, transaction_type, direction, amount_cents, status, due_date) values ('Luz', 'expense', 'out', 3000, 'pending', $1), ('Freela', 'income', 'in', 5000, 'forecast', $2)",
      [addDays(today(), -4), addDays(today(), 2)],
    );
    const proj = await userQuery(db, u, 'select * from public.balance_projection($1, true, true, true, true)', [
      addDays(today(), 3),
    ]);
    expect(Number(proj[0].outflow_cents)).toBe(3000);
    expect(Number(proj[0].balance_cents)).toBe(7000);
    expect(Number(proj[2].balance_cents)).toBe(12000);
    expect(Number(proj[2].uncertain_cents)).toBe(5000);
  });
});

describe('Segurança e concorrência das dívidas', () => {
  it('outro usuário não vê, paga, reordena nem lança encargos em dívida alheia', async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const aliceAcc = await createAccount(db, alice, { opening: 100000 });
    const bobAcc = await createAccount(db, bob, { opening: 100000 });
    const debt = await createDebt(alice);

    expect(await userQuery(db, bob, 'select * from public.debts where id = $1', [debt.id])).toHaveLength(0);
    expect(await userQuery(db, bob, 'select * from public.debt_balances where debt_id = $1', [debt.id])).toHaveLength(0);
    await expect(payDebt(bob, debt.id, bobAcc, 100)).rejects.toThrow(/não encontrada/);
    await expect(payDebt(alice, debt.id, bobAcc, 100)).rejects.toThrow(/Conta não encontrada/);
    await expect(userQuery(db, bob, 'select public.reorder_debts($1)', [[debt.id]])).rejects.toThrow(/não encontrada/);
    await expect(
      userQuery(db, bob, "select public.add_debt_charge($1, 'fine', 100, current_date, null, $2)", [debt.id, uuid()]),
    ).rejects.toThrow(/não encontrada/);
    expect(await balanceOf(db, alice, aliceAcc)).toBe(100000);
  });

  it('Teste J — pagamentos simultâneos não abatem além do saldo nem duplicam a saída', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 500000 });
    const debt = await createDebt(u, { original_amount_cents: 50000 });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => payDebt(u, debt.id, acc, 50000)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balanceOf(db, u, acc)).toBe(450000);
    const b = await debtBalance(u, debt.id);
    expect(Number(b.outstanding_cents)).toBe(0);
  });

  it('mesma chave de idempotência repetida não paga duas vezes', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 500000 });
    const debt = await createDebt(u, { original_amount_cents: 90000 });
    const key = uuid();
    const results = await Promise.all(Array.from({ length: 4 }, () => payDebt(u, debt.id, acc, 10000, 0, key)));
    expect(new Set(results.map((r) => r.payment_id)).size).toBe(1);
    expect(await balanceOf(db, u, acc)).toBe(490000);
  });
});
