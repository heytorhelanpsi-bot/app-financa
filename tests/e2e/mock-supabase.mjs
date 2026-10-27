// Servidor de teste que imita o subconjunto da API do Supabase usado pelo app
// (PostgREST + Auth). As consultas rodam no PostgreSQL real como o papel
// `authenticated` com as claims do JWT — portanto RLS, triggers e funções são
// exatamente os de produção. Realtime não é emulado.
// Uso: node tests/e2e/mock-supabase.mjs <database-url> <porta>
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const [, , DB_URL = 'postgres://postgres:postgres@localhost:5432/financa_e2e', PORT = '54321'] = process.argv;
// Como o PostgREST, devolve datas como 'AAAA-MM-DD' (sem conversão para timestamp).
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));
const pool = new pg.Pool({ connectionString: DB_URL, max: 10 });
const SECRET = 'e2e-secret';
const TABLES = new Set(['profiles', 'accounts', 'categories', 'transactions', 'audit_logs', 'account_balances']);
const RPCS = new Set(['settle_transaction', 'create_transfer', 'adjust_account_balance', 'reverse_transaction', 'financial_summary']);

await pool.query(`create table if not exists public.e2e_passwords (user_id uuid primary key, email text unique, password text)`);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(user) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', email: user.email, iat: now, exp: now + 3600, aud: 'authenticated' })}`;
  return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}
function verify(token) {
  const [h, p, s] = (token ?? '').split('.');
  if (!s || crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  return claims.exp > Date.now() / 1000 ? claims : null;
}
const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: u.raw_user_meta_data ?? {}, app_metadata: { provider: 'email' }, created_at: u.created_at });
const session = (u) => ({ access_token: jwt(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r:${u.id}`, user: userJson(u) });

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d ? JSON.parse(d) : null)); });
const qi = (name) => { if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw Object.assign(new Error('bad identifier'), { code: 'PGRST100' }); return `"${name}"`; };

async function asUser(claims, sql, params) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (claims) {
      await c.query("select set_config('role','authenticated',true), set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
    } else {
      await c.query("select set_config('role','anon',true)");
    }
    const r = await c.query(sql, params);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

function buildWhere(params, values) {
  const conds = [];
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const i = raw.indexOf('.');
    const op = raw.slice(0, i);
    const val = raw.slice(i + 1);
    const col = qi(k);
    const ops = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
    if (ops[op]) { values.push(val); conds.push(`${col} ${ops[op]} $${values.length}`); }
    else if (op === 'is') conds.push(`${col} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`);
    else if (op === 'in') {
      const items = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
      values.push(items); conds.push(`${col}::text = any($${values.length}::text[])`);
    } else if (op === 'ilike' || op === 'like') { values.push(val.replace(/\*/g, '%')); conds.push(`${col} ${op} $${values.length}`); }
    else throw Object.assign(new Error(`op ${op} não suportado`), { code: 'PGRST100' });
  }
  return conds.length ? ` where ${conds.join(' and ')}` : '';
}
const selectList = (s) => (!s || s === '*' ? '*' : s.split(',').map((c) => qi(c.trim())).join(', '));
const orderBy = (o) => (o ? ' order by ' + o.split(',').map((p) => { const [c, dir] = p.split('.'); return `${qi(c)} ${dir === 'desc' ? 'desc' : 'asc'}`; }).join(', ') : '');

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, 'http://x');
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const claims = verify(token);

    // ------------------------------------------------------------- Auth
    if (url.pathname.startsWith('/auth/v1/')) {
      const path = url.pathname.slice(9);
      const body = await readBody(req);
      if (path === 'signup') {
        const exists = await pool.query('select 1 from public.e2e_passwords where email=$1', [body.email]);
        if (exists.rowCount) return send(res, 400, { code: 'user_already_exists', msg: 'User already registered', error_code: 'user_already_exists' });
        const { rows: [u] } = await pool.query('insert into auth.users (email, raw_user_meta_data) values ($1,$2) returning *', [body.email, body.data ?? {}]);
        await pool.query('insert into public.e2e_passwords values ($1,$2,$3)', [u.id, body.email, body.password]);
        return send(res, 200, session(u));
      }
      if (path === 'token') {
        let uid;
        if (url.searchParams.get('grant_type') === 'refresh_token') uid = String(body.refresh_token).slice(2);
        else {
          const r = await pool.query('select user_id from public.e2e_passwords where email=$1 and password=$2', [body.email, body.password]);
          if (!r.rowCount) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
          uid = r.rows[0].user_id;
        }
        const { rows: [u] } = await pool.query('select * from auth.users where id=$1', [uid]);
        return u ? send(res, 200, session(u)) : send(res, 400, { msg: 'Invalid Refresh Token' });
      }
      if (path === 'user') {
        if (!claims) return send(res, 401, { msg: 'invalid JWT' });
        if (req.method === 'PUT' && body?.password) await pool.query('update public.e2e_passwords set password=$2 where user_id=$1', [claims.sub, body.password]);
        const { rows: [u] } = await pool.query('select * from auth.users where id=$1', [claims.sub]);
        return send(res, 200, userJson(u));
      }
      if (path === 'logout') return send(res, 204);
      if (path === 'recover') return send(res, 200, {});
      return send(res, 404, { msg: 'not found' });
    }

    // ------------------------------------------------------------- REST
    if (!url.pathname.startsWith('/rest/v1/')) return send(res, 404, { message: 'not found' });
    const name = url.pathname.slice(9);
    const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object');
    const prefer = req.headers.prefer ?? '';
    const values = [];

    if (name.startsWith('rpc/')) {
      const fn = name.slice(4);
      if (!RPCS.has(fn)) return send(res, 404, { code: 'PGRST202', message: 'function not found' });
      const body = (await readBody(req)) ?? {};
      const args = Object.entries(body).map(([k, v]) => { values.push(Array.isArray(v) ? v : v); return `${qi(k)} => $${values.length}`; });
      const r = await asUser(claims, `select to_jsonb(public.${qi(fn)}(${args.join(', ')})) as r`, values);
      return send(res, 200, r.rows[0].r);
    }

    if (!TABLES.has(name)) return send(res, 404, { code: '42P01', message: 'relation not found' });
    const p = [...url.searchParams.entries()];
    const sel = url.searchParams.get('select');
    let r;
    if (req.method === 'GET') {
      const limit = url.searchParams.get('limit');
      const offset = url.searchParams.get('offset');
      const where = buildWhere(p, values);
      r = await asUser(claims, `select ${selectList(sel)} from public.${qi(name)}${where}${orderBy(url.searchParams.get('order'))}${limit ? ` limit ${Number(limit)}` : ''}${offset ? ` offset ${Number(offset)}` : ''}`, values);
    } else if (req.method === 'POST') {
      const body = await readBody(req);
      const rows = Array.isArray(body) ? body : [body];
      const cols = Object.keys(rows[0]);
      const tuples = rows.map((row) => `(${cols.map((c) => { values.push(Array.isArray(row[c]) ? row[c] : row[c]); return `$${values.length}`; }).join(', ')})`);
      const conflict = prefer.includes('ignore-duplicates') ? ` on conflict (${qi(url.searchParams.get('on_conflict') ?? 'id')}) do nothing` : '';
      r = await asUser(claims, `insert into public.${qi(name)} (${cols.map(qi).join(', ')}) values ${tuples.join(', ')}${conflict} returning *`, values);
    } else if (req.method === 'PATCH') {
      const body = await readBody(req);
      const sets = Object.entries(body).map(([k, v]) => { values.push(v); return `${qi(k)} = $${values.length}`; });
      r = await asUser(claims, `update public.${qi(name)} set ${sets.join(', ')}${buildWhere(p, values)} returning *`, values);
    } else if (req.method === 'DELETE') {
      r = await asUser(claims, `delete from public.${qi(name)}${buildWhere(p, values)} returning *`, values);
    }
    if (prefer.includes('return=minimal') && req.method !== 'GET') return send(res, 201);
    if (wantsObject) return r.rows.length === 1 ? send(res, 200, r.rows[0]) : send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
    return send(res, 200, r.rows);
  } catch (e) {
    const status = e.code === '42501' ? 403 : 400;
    send(res, status, { code: e.code ?? 'XX000', message: e.message, hint: e.hint ?? null, details: e.detail ?? null });
  }
});

server.listen(Number(PORT), () => console.log(`mock supabase on :${PORT}`));
