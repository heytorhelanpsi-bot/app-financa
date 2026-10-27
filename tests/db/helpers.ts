import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const ROOT = join(__dirname, '..', '..');

export interface TestDb {
  pool: pg.Pool;
  dbName: string;
  drop(): Promise<void>;
}

/** Cria um banco isolado, aplica a emulação do Supabase e todas as migrações. */
export async function createTestDb(): Promise<TestDb> {
  const dbName = `financa_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 10 });

  await pool.query(readFileSync(join(ROOT, 'tests/db/supabase-shim.sql'), 'utf8'));
  const migrationsDir = join(ROOT, 'supabase/migrations');
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(join(migrationsDir, file), 'utf8'));
  }

  return {
    pool,
    dbName,
    async drop() {
      await pool.end();
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`drop database if exists ${dbName} with (force)`);
      await c.end();
    },
  };
}

/** Cria um usuário em auth.users (dispara a criação de perfil e categorias). */
export async function createUser(db: TestDb, email = `${randomUUID()}@teste.local`): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    'insert into auth.users (email) values ($1) returning id',
    [email],
  );
  return rows[0].id;
}

export type Q = <T extends pg.QueryResultRow = any>(sql: string, params?: unknown[]) => Promise<T[]>;

/**
 * Executa `fn` como o papel `authenticated` com o JWT do usuário, exatamente
 * como o PostgREST faz para cada requisição (uma transação por chamada).
 */
export async function asUser<T>(db: TestDb, userId: string, fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await db.pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('role', 'authenticated', true)");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    const q: Q = async (sql, params) => (await client.query(sql, params as any[])).rows;
    const result = await fn(q);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Atalho para uma única consulta como usuário. */
export function userQuery<T extends pg.QueryResultRow = any>(
  db: TestDb,
  userId: string,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  return asUser(db, userId, (q) => q<T>(sql, params));
}

export async function createAccount(
  db: TestDb,
  userId: string,
  opts: { name?: string; opening?: number; type?: string; openingDate?: string } = {},
): Promise<string> {
  const rows = await userQuery<{ id: string }>(
    db,
    userId,
    `insert into public.accounts (name, account_type, opening_balance_cents, opening_date)
     values ($1, $2, $3, $4) returning id`,
    [opts.name ?? 'Conta', opts.type ?? 'checking', opts.opening ?? 0, opts.openingDate ?? '2026-01-01'],
  );
  return rows[0].id;
}

export async function balanceOf(db: TestDb, userId: string, accountId: string): Promise<number> {
  const rows = await userQuery<{ balance_cents: string }>(
    db,
    userId,
    'select balance_cents from public.account_balances where account_id = $1',
    [accountId],
  );
  return Number(rows[0].balance_cents);
}

export const uuid = randomUUID;
