import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  balanceOf,
  createAccount,
  createTestDb,
  createUser,
  userQuery,
  uuid,
  type TestDb,
} from './helpers';

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

async function insertTx(userId: string, fields: Record<string, unknown>): Promise<any> {
  const base: Record<string, unknown> = {
    description: 'Lançamento',
    transaction_type: 'expense',
    direction: 'out',
    status: 'pending',
    competence_date: today(),
    ...fields,
  };
  if (base.transaction_type === 'income' && !fields.direction) base.direction = 'in';
  const cols = Object.keys(base);
  const rows = await userQuery(
    db,
    userId,
    `insert into public.transactions (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    cols.map((c) => base[c]),
  );
  return rows[0];
}

function settle(userId: string, txId: string, accountId: string, amount: number, key = uuid(), date = today()) {
  return userQuery(db, userId, 'select * from public.settle_transaction($1, $2, $3, $4, $5)', [
    txId,
    accountId,
    date,
    amount,
    key,
  ]);
}

async function summary(userId: string, start: string, end: string, opts: unknown[] = []) {
  const rows = await userQuery(
    db,
    userId,
    `select public.financial_summary($1, $2, null, ${opts.length ? opts.map((_, i) => `$${i + 3}`).join(', ') : 'true, false, false'}) as s`,
    [start, end, ...opts],
  );
  return rows[0].s;
}

describe('Cadastro inicial', () => {
  it('cria perfil e categorias padrão para um novo usuário', async () => {
    const u = await createUser(db);
    const profile = await userQuery(db, u, 'select * from public.profiles');
    expect(profile).toHaveLength(1);
    expect(profile[0].currency_code).toBe('BRL');
    const cats = await userQuery(db, u, 'select name from public.categories order by sort_order');
    expect(cats.map((c) => c.name)).toContain('Moradia');
    expect(cats).toHaveLength(15);
  });
});

describe('Teste A — saldo', () => {
  it('despesa de R$ 500 paga reduz o saldo de R$ 4.000 para R$ 3.500 uma única vez', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 400000 });
    const tx = await insertTx(u, { description: 'Mercado', amount_cents: 50000 });
    expect(await balanceOf(db, u, acc)).toBe(400000);

    await settle(u, tx.id, acc, 50000);
    expect(await balanceOf(db, u, acc)).toBe(350000);

    // Reenvio da mesma operação com outra chave é recusado; o saldo não muda.
    await expect(settle(u, tx.id, acc, 50000)).rejects.toThrow(/já foi efetivado/);
    expect(await balanceOf(db, u, acc)).toBe(350000);
  });

  it('despesa registrada já paga também reduz o saldo uma única vez', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 400000 });
    await insertTx(u, {
      amount_cents: 50000,
      status: 'paid',
      account_id: acc,
      settled_at: today(),
      settled_amount_cents: 50000,
    });
    expect(await balanceOf(db, u, acc)).toBe(350000);
  });
});

describe('Teste B — despesa pendente', () => {
  it('não altera o saldo bancário, mas entra na projeção', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 400000 });
    await insertTx(u, { amount_cents: 80000, due_date: addDays(today(), 5), account_id: acc });

    expect(await balanceOf(db, u, acc)).toBe(400000);
    const s = await summary(u, today(), addDays(today(), 30));
    expect(Number(s.bank_balance_cents)).toBe(400000);
    expect(Number(s.committed_cents)).toBe(80000);
    expect(Number(s.free_cents)).toBe(320000);
    expect(Number(s.projected_end_cents)).toBe(320000);
  });
});

describe('Teste C — receita prevista', () => {
  it('não aumenta o saldo efetivo antes do recebimento', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 400000 });
    const inc = await insertTx(u, {
      transaction_type: 'income',
      status: 'forecast',
      amount_cents: 150000,
      due_date: addDays(today(), 3),
      account_id: acc,
    });

    expect(await balanceOf(db, u, acc)).toBe(400000);
    const s = await summary(u, today(), addDays(today(), 30));
    expect(Number(s.bank_balance_cents)).toBe(400000);
    expect(Number(s.free_cents)).toBe(400000); // cenário conservador não considera
    expect(Number(s.projected_end_cents)).toBe(550000);
    expect(Number(s.projection_uncertain_income_cents)).toBe(150000);

    const optimistic = await summary(u, today(), addDays(today(), 30), [true, true, true]);
    expect(Number(optimistic.free_cents)).toBe(550000);

    await settle(u, inc.id, acc, 150000);
    expect(await balanceOf(db, u, acc)).toBe(550000);
  });
});

describe('Teste F — transferência', () => {
  it('move R$ 200 entre contas sem alterar receitas e despesas consolidadas', async () => {
    const u = await createUser(db);
    const a = await createAccount(db, u, { name: 'A', opening: 100000 });
    const b = await createAccount(db, u, { name: 'B', opening: 0 });
    const before = await summary(u, addDays(today(), -1), addDays(today(), 1));

    const key = uuid();
    await userQuery(db, u, 'select public.create_transfer($1, $2, 20000, $3, $4, $5)', [a, b, today(), 'Reserva', key]);
    expect(await balanceOf(db, u, a)).toBe(80000);
    expect(await balanceOf(db, u, b)).toBe(20000);

    const after = await summary(u, addDays(today(), -1), addDays(today(), 1));
    expect(after.expenses).toEqual(before.expenses);
    expect(after.income).toEqual(before.income);
    expect(Number(after.bank_balance_cents)).toBe(Number(before.bank_balance_cents));

    // Repetição com a mesma chave não duplica.
    await userQuery(db, u, 'select public.create_transfer($1, $2, 20000, $3, $4, $5)', [a, b, today(), 'Reserva', key]);
    expect(await balanceOf(db, u, a)).toBe(80000);
  });

  it('impede transferir benefício restrito para conta de dinheiro', async () => {
    const u = await createUser(db);
    const va = await createAccount(db, u, { name: 'VA', type: 'benefit', opening: 50000 });
    const cc = await createAccount(db, u, { name: 'CC', opening: 0 });
    await expect(
      userQuery(db, u, 'select public.create_transfer($1, $2, 100, $3, null, $4)', [va, cc, today(), uuid()]),
    ).rejects.toThrow(/benefícios/);
  });

  it('transferências não podem ser inseridas diretamente', async () => {
    const u = await createUser(db);
    const a = await createAccount(db, u, { opening: 0 });
    await expect(
      insertTx(u, {
        transaction_type: 'transfer',
        direction: 'in',
        status: 'received',
        amount_cents: 999999,
        settled_amount_cents: 999999,
        settled_at: today(),
        account_id: a,
        transfer_group_id: uuid(),
      }),
    ).rejects.toThrow(/operações próprias/);
  });
});

describe('Benefícios restritos', () => {
  it('não entram no saldo bancário livre', async () => {
    const u = await createUser(db);
    await createAccount(db, u, { name: 'Corrente', opening: 100000 });
    await createAccount(db, u, { name: 'VA', type: 'benefit', opening: 60000 });
    const s = await summary(u, today(), addDays(today(), 7));
    expect(Number(s.bank_balance_cents)).toBe(100000);
    expect(Number(s.benefit_balance_cents)).toBe(60000);
    expect(Number(s.free_cents)).toBe(100000);
  });
});

describe('Integridade de lançamentos efetivados', () => {
  it('não permite alterar valor nem excluir; estorno mantém histórico e reabre', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 100000 });
    const tx = await insertTx(u, { amount_cents: 3000 });
    await settle(u, tx.id, acc, 3000);

    await expect(
      userQuery(db, u, 'update public.transactions set amount_cents = 1 where id = $1', [tx.id]),
    ).rejects.toThrow(/não podem ser alterados/);
    await expect(
      userQuery(db, u, 'update public.transactions set settled_amount_cents = 1 where id = $1', [tx.id]),
    ).rejects.toThrow(/não podem ser alterados/);
    await expect(userQuery(db, u, 'delete from public.transactions where id = $1', [tx.id])).rejects.toThrow(
      /não podem ser excluídos/,
    );
    // Campos descritivos continuam editáveis.
    await userQuery(db, u, "update public.transactions set description = 'Farmácia' where id = $1", [tx.id]);

    const res = await userQuery(db, u, 'select public.reverse_transaction($1, $2, true, $3) as r', [
      tx.id,
      'valor errado',
      uuid(),
    ]);
    expect(await balanceOf(db, u, acc)).toBe(100000);
    const reopened = res[0].r.reopened_id as string;
    const rows = await userQuery(db, u, 'select status, amount_cents from public.transactions where id = $1', [reopened]);
    expect(rows[0].status).toBe('pending');

    await expect(
      userQuery(db, u, 'select public.reverse_transaction($1, null, false, $2)', [tx.id, uuid()]),
    ).rejects.toThrow(/já foi estornado/);

    const audit = await userQuery(db, u, "select action, context from public.audit_logs where entity_id = $1 order by created_at", [tx.id]);
    expect(audit.map((a) => a.context)).toContain('settle');
    expect(audit.map((a) => a.context)).toContain('reverse');
  });

  it('não permite efetivar por UPDATE direto', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 0 });
    const tx = await insertTx(u, { amount_cents: 100 });
    await expect(
      userQuery(
        db,
        u,
        "update public.transactions set status='paid', account_id=$2, settled_at=current_date, settled_amount_cents=100 where id=$1",
        [tx.id, acc],
      ),
    ).rejects.toThrow(/Confirmar pagamento/);
  });

  it('não permite data efetiva anterior ao saldo inicial', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 0, openingDate: today() });
    const tx = await insertTx(u, { amount_cents: 100 });
    await expect(settle(u, tx.id, acc, 100, uuid(), addDays(today(), -10))).rejects.toThrow(/saldo inicial/);
  });

  it('bloqueia alteração do saldo inicial após lançamentos e permite ajuste rastreável', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 1000 });
    await insertTx(u, { amount_cents: 100, account_id: acc });
    await expect(
      userQuery(db, u, 'update public.accounts set opening_balance_cents = 999999 where id = $1', [acc]),
    ).rejects.toThrow(/não podem ser alterados depois/);

    await userQuery(db, u, "select public.adjust_account_balance($1, 5000, $2, 'conferência', $3)", [acc, today(), uuid()]);
    expect(await balanceOf(db, u, acc)).toBe(5000);
    const s = await summary(u, today(), today());
    expect(Number(s.expenses.paid_cents)).toBe(0); // ajuste não é despesa/receita consolidada
    expect(Number(s.income.received_cents)).toBe(0);
  });

  it('valida valores e categorias incompatíveis', async () => {
    const u = await createUser(db);
    await expect(insertTx(u, { amount_cents: 0 })).rejects.toThrow();
    await expect(insertTx(u, { amount_cents: -10 })).rejects.toThrow();
    const [salario] = await userQuery(db, u, "select id from public.categories where name = 'Salário'");
    await expect(insertTx(u, { amount_cents: 10, category_id: salario.id })).rejects.toThrow(/categoria é de receitas/);
  });

  it('lançamento sem categoria é permitido', async () => {
    const u = await createUser(db);
    const tx = await insertTx(u, { amount_cents: 10 });
    expect(tx.category_id).toBeNull();
  });
});

describe('Teste G — sincronização sem duplicação', () => {
  it('reenvio do mesmo lançamento (mesmo id gerado no dispositivo) não duplica', async () => {
    const u = await createUser(db);
    const id = uuid();
    const sql = `insert into public.transactions (id, description, transaction_type, direction, amount_cents, status)
                 values ($1, 'Celular', 'expense', 'out', 1234, 'pending') on conflict (id) do nothing`;
    await userQuery(db, u, sql, [id]);
    await userQuery(db, u, sql, [id]);
    const rows = await userQuery(db, u, 'select id from public.transactions');
    expect(rows).toHaveLength(1);
  });

  it('controle de versão detecta edição concorrente', async () => {
    const u = await createUser(db);
    const tx = await insertTx(u, { amount_cents: 10 });
    const first = await userQuery(db, u, "update public.transactions set description='A' where id=$1 and version=$2 returning version", [tx.id, tx.version]);
    expect(first).toHaveLength(1);
    const stale = await userQuery(db, u, "update public.transactions set description='B' where id=$1 and version=$2 returning version", [tx.id, tx.version]);
    expect(stale).toHaveLength(0);
  });
});

describe('Teste H — segurança entre usuários', () => {
  it('um usuário não lê, altera, exclui nem referencia dados de outro', async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const aliceAcc = await createAccount(db, alice, { opening: 100000 });
    const aliceTx = await insertTx(alice, { amount_cents: 500, account_id: aliceAcc });
    const [aliceCat] = await userQuery(db, alice, "select id from public.categories where name='Moradia'");

    expect(await userQuery(db, bob, 'select * from public.transactions where id = $1', [aliceTx.id])).toHaveLength(0);
    expect(await userQuery(db, bob, 'select * from public.accounts where id = $1', [aliceAcc])).toHaveLength(0);
    expect(await userQuery(db, bob, 'select * from public.account_balances where account_id = $1', [aliceAcc])).toHaveLength(0);
    expect(await userQuery(db, bob, 'select * from public.profiles where id = $1', [alice])).toHaveLength(0);
    expect(await userQuery(db, bob, 'select * from public.audit_logs where user_id = $1', [alice])).toHaveLength(0);

    const upd = await userQuery(db, bob, "update public.transactions set description='hack' where id=$1 returning id", [aliceTx.id]);
    expect(upd).toHaveLength(0);
    const del = await userQuery(db, bob, 'delete from public.transactions where id=$1 returning id', [aliceTx.id]);
    expect(del).toHaveLength(0);

    // Inserir em nome de outro usuário.
    await expect(
      userQuery(db, bob, "insert into public.accounts (user_id, name, account_type) values ($1, 'x', 'cash')", [alice]),
    ).rejects.toThrow(/row-level security/);
    // Referenciar conta ou categoria de outro usuário.
    await expect(insertTx(bob, { amount_cents: 1, account_id: aliceAcc })).rejects.toThrow(/Conta não encontrada/);
    await expect(insertTx(bob, { amount_cents: 1, category_id: aliceCat.id })).rejects.toThrow(/Categoria não encontrada/);
    // Liquidar lançamento de outro usuário ou usar conta alheia.
    await expect(settle(bob, aliceTx.id, aliceAcc, 500)).rejects.toThrow(/não encontrad/);
    const bobAcc = await createAccount(db, bob, { opening: 0 });
    await expect(settle(bob, aliceTx.id, bobAcc, 500)).rejects.toThrow(/não encontrado/);
    await expect(
      userQuery(db, bob, 'select public.create_transfer($1, $2, 100, $3, null, $4)', [aliceAcc, bobAcc, today(), uuid()]),
    ).rejects.toThrow(/Conta não encontrada/);
    await expect(
      userQuery(db, bob, 'select public.reverse_transaction($1, null, false, $2)', [aliceTx.id, uuid()]),
    ).rejects.toThrow(/não encontrado/);
    await expect(
      userQuery(db, bob, "select public.adjust_account_balance($1, 0, $2, null, $3)", [aliceAcc, today(), uuid()]),
    ).rejects.toThrow(/Conta não encontrada/);

    // Auditoria não pode ser forjada nem apagada.
    await expect(
      userQuery(db, bob, "insert into public.audit_logs (user_id, entity_type, entity_id, action) values ($1,'x',$1,'x')", [bob]),
    ).rejects.toThrow(/permission denied/);

    expect(await balanceOf(db, alice, aliceAcc)).toBe(100000);
  });

  it('usuário anônimo não acessa nada', async () => {
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query("set local role anon");
      await expect(client.query('select * from public.transactions')).rejects.toThrow(/permission denied/);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('funções internas não são executáveis por anônimos', async () => {
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role anon');
      await expect(
        client.query("select public.financial_summary(current_date, current_date)"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});

describe('Idempotência', () => {
  it('a mesma chave de confirmação devolve o mesmo resultado sem nova saída', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 10000 });
    const tx = await insertTx(u, { amount_cents: 1000 });
    const key = uuid();
    const r1 = await settle(u, tx.id, acc, 1000, key);
    const r2 = await settle(u, tx.id, acc, 1000, key);
    expect(r1[0].id).toBe(r2[0].id);
    expect(await balanceOf(db, u, acc)).toBe(9000);
  });

  it('a mesma chave não pode ser reutilizada em outra operação', async () => {
    const u = await createUser(db);
    const a = await createAccount(db, u, { opening: 10000 });
    const b = await createAccount(db, u, { opening: 0 });
    const key = uuid();
    await userQuery(db, u, 'select public.create_transfer($1, $2, 100, $3, null, $4)', [a, b, today(), key]);
    await expect(
      userQuery(db, u, "select public.adjust_account_balance($1, 0, $2, null, $3)", [a, today(), key]),
    ).rejects.toThrow(/outra operação/);
  });
});

describe('Teste J — concorrência', () => {
  it('duas confirmações simultâneas do mesmo pagamento registram uma única saída', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 400000 });
    const tx = await insertTx(u, { amount_cents: 50000 });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => settle(u, tx.id, acc, 50000, uuid())),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balanceOf(db, u, acc)).toBe(350000);
  });

  it('pedidos simultâneos com a mesma chave de idempotência também não duplicam', async () => {
    const u = await createUser(db);
    const a = await createAccount(db, u, { opening: 100000 });
    const b = await createAccount(db, u, { opening: 0 });
    const key = uuid();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        userQuery(db, u, 'select public.create_transfer($1, $2, 20000, $3, null, $4) as g', [a, b, today(), key]),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any[]>[];
    expect(ok).toHaveLength(6);
    expect(new Set(ok.map((r) => r.value[0].g)).size).toBe(1);
    expect(await balanceOf(db, u, a)).toBe(80000);
    expect(await balanceOf(db, u, b)).toBe(20000);
  });

  it('dois estornos simultâneos geram um único estorno', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 10000 });
    const tx = await insertTx(u, { amount_cents: 1000 });
    await settle(u, tx.id, acc, 1000);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        userQuery(db, u, 'select public.reverse_transaction($1, null, false, $2)', [tx.id, uuid()]),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balanceOf(db, u, acc)).toBe(10000);
  });
});

describe('Resumo da tela inicial', () => {
  it('separa pagas, pendentes, previstas e vencidas', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 500000 });
    const t = today();
    const paid = await insertTx(u, { amount_cents: 10000, due_date: t });
    await settle(u, paid.id, acc, 10000);
    await insertTx(u, { amount_cents: 20000, due_date: addDays(t, 2) });
    await insertTx(u, { amount_cents: 30000, status: 'forecast', due_date: addDays(t, 3) });
    await insertTx(u, { amount_cents: 40000, due_date: addDays(t, -5) }); // vencida
    await insertTx(u, { amount_cents: 99999, status: 'canceled', due_date: t }); // ignorada
    await insertTx(u, { transaction_type: 'income', amount_cents: 70000, status: 'pending', due_date: addDays(t, 1) });

    const s = await summary(u, t, addDays(t, 10));
    expect(Number(s.bank_balance_cents)).toBe(490000);
    expect(Number(s.expenses.paid_cents)).toBe(10000);
    expect(Number(s.expenses.pending_cents)).toBe(20000);
    expect(Number(s.expenses.forecast_cents)).toBe(30000);
    expect(Number(s.expenses.overdue_cents)).toBe(40000);
    expect(Number(s.expenses.overdue_count)).toBe(1);
    expect(Number(s.committed_cents)).toBe(90000); // pendente + prevista + vencida
    expect(Number(s.free_cents)).toBe(400000);
    expect(Number(s.income.pending_cents)).toBe(70000);
    expect(Number(s.projected_end_cents)).toBe(490000 - 90000 + 70000);

    const withoutForecast = await summary(u, t, addDays(t, 10), [false, true, false]);
    expect(Number(withoutForecast.committed_cents)).toBe(60000);
    expect(Number(withoutForecast.free_cents)).toBe(490000 - 60000 + 70000);
  });

  it('despesa estornada sai dos totais consolidados', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 10000 });
    const tx = await insertTx(u, { amount_cents: 1000 });
    await settle(u, tx.id, acc, 1000);
    await userQuery(db, u, 'select public.reverse_transaction($1, null, false, $2)', [tx.id, uuid()]);
    const s = await summary(u, addDays(today(), -1), addDays(today(), 1));
    expect(Number(s.expenses.paid_cents)).toBe(0);
    expect(Number(s.bank_balance_cents)).toBe(10000);
  });
});

describe('Exclusão da conta do usuário', () => {
  it('remove todos os dados em cascata sem violar regras', async () => {
    const u = await createUser(db);
    const acc = await createAccount(db, u, { opening: 100 });
    const tx = await insertTx(u, { amount_cents: 50 });
    await settle(u, tx.id, acc, 50);
    await db.pool.query('delete from auth.users where id = $1', [u]);
    const { rows } = await db.pool.query('select count(*)::int as n from public.transactions where user_id = $1', [u]);
    expect(rows[0].n).toBe(0);
  });
});

describe('Categorias', () => {
  it('impede excluir categoria em uso e permite desativar', async () => {
    const u = await createUser(db);
    const [cat] = await userQuery(db, u, "select id from public.categories where name='Lazer'");
    await insertTx(u, { amount_cents: 10, category_id: cat.id });
    await expect(userQuery(db, u, 'delete from public.categories where id=$1', [cat.id])).rejects.toThrow(/em uso/);
    await userQuery(db, u, 'update public.categories set is_active=false where id=$1', [cat.id]);
    await expect(insertTx(u, { amount_cents: 10, category_id: cat.id })).rejects.toThrow(/desativada/);
  });

  it('subcategorias têm apenas um nível', async () => {
    const u = await createUser(db);
    const [parent] = await userQuery(db, u, "select id from public.categories where name='Moradia'");
    const [child] = await userQuery(db, u, "insert into public.categories (name, category_type, parent_id) values ('Aluguel','expense',$1) returning id", [parent.id]);
    await expect(
      userQuery(db, u, "insert into public.categories (name, category_type, parent_id) values ('X','expense',$1)", [child.id]),
    ).rejects.toThrow(/um nível/);
  });
});

