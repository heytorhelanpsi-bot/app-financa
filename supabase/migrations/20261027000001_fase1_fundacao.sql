-- =============================================================================
-- Financeiro Pessoal Inteligente — Fase 1 (Fundação)
--
-- Convenções:
--   * Valores monetários em centavos (bigint). Nunca ponto flutuante.
--   * Toda tabela privada possui user_id + RLS. Chaves estrangeiras compostas
--     (id, user_id) impedem que um registro aponte para dados de outro usuário.
--   * Saldos NUNCA são armazenados: são derivados de saldo inicial + movimentos
--     efetivados (view public.account_balances).
--   * Operações críticas (liquidar, transferir, estornar, ajustar) passam por
--     funções RPC atômicas com chave de idempotência.
--   * Funções auxiliares ficam no schema app_private, que não é exposto pela API.
-- =============================================================================

create extension if not exists pgcrypto;

create schema if not exists app_private;
grant usage on schema app_private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Utilitários
-- -----------------------------------------------------------------------------

create or replace function app_private.tg_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

-- Papéis da API (PostgREST) que estão sujeitos às regras de negócio.
-- Papéis administrativos (postgres, service_role, supabase_auth_admin) ignoram
-- as restrições de fluxo, mas continuam sujeitos às constraints.
create or replace function app_private.is_api_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('authenticated', 'anon');
$$;

-- Operações internas (RPCs) sinalizam, apenas dentro da transação corrente,
-- que estão autorizadas a executar transições protegidas.
create or replace function app_private.is_trusted_op()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.trusted_op', true), '') = 'on';
$$;

create or replace function app_private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Sessão inválida. Entre novamente.';
  end if;
  return v_uid;
end;
$$;

create or replace function app_private.raise_business(p_message text, p_hint text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = coalesce(p_hint, '');
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text check (display_name is null or char_length(display_name) <= 80),
  currency_code char(3) not null default 'BRL' check (currency_code ~ '^[A-Z]{3}$'),
  timezone      text not null default 'America/Sao_Paulo' check (char_length(timezone) <= 64),
  theme         text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1
);

create or replace function app_private.tg_profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    perform app_private.raise_business('O identificador do perfil não pode ser alterado.');
  end if;
  begin
    perform now() at time zone new.timezone;
  exception when others then
    perform app_private.raise_business('Fuso horário inválido.');
  end;
  return new;
end;
$$;

create trigger profiles_guard before insert or update on public.profiles
  for each row execute function app_private.tg_profiles_guard();
create trigger profiles_touch before update on public.profiles
  for each row execute function app_private.tg_touch();

-- Data "de hoje" no fuso do usuário (evita virar o dia às 21h em UTC-3).
create or replace function app_private.user_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select p.timezone from public.profiles p where p.id = auth.uid()),
    'America/Sao_Paulo'))::date;
$$;

-- -----------------------------------------------------------------------------
-- accounts — contas bancárias, carteiras e benefícios
-- -----------------------------------------------------------------------------

create table public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                  text not null check (char_length(btrim(name)) between 1 and 80),
  institution_name      text check (institution_name is null or char_length(institution_name) <= 80),
  account_type          text not null check (account_type in ('checking', 'savings', 'cash', 'investment', 'benefit', 'other')),
  currency_code         char(3) not null default 'BRL' check (currency_code ~ '^[A-Z]{3}$'),
  opening_balance_cents bigint not null default 0 check (abs(opening_balance_cents) <= 100000000000000),
  opening_date          date not null default current_date,
  color                 text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order            integer not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  version               integer not null default 1,
  unique (id, user_id)
);

create index accounts_user_idx on public.accounts (user_id, sort_order);

comment on column public.accounts.account_type is
  'benefit = benefício de uso restrito (ex.: vale-alimentação). Nunca é somado ao saldo livre em dinheiro.';

-- -----------------------------------------------------------------------------
-- categories
-- -----------------------------------------------------------------------------

create table public.categories (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  category_type text not null check (category_type in ('income', 'expense', 'both')),
  parent_id     uuid,
  color         text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  is_essential  boolean not null default false,
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,
  unique (id, user_id),
  foreign key (parent_id, user_id) references public.categories (id, user_id),
  check (parent_id is null or parent_id <> id)
);

create unique index categories_unique_name
  on public.categories (user_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index categories_user_idx on public.categories (user_id, sort_order);

-- -----------------------------------------------------------------------------
-- transactions — receitas, despesas, transferências, ajustes e estornos
-- -----------------------------------------------------------------------------
-- Datas:
--   competence_date : mês/dia a que o fato econômico pertence (relatórios).
--   due_date        : data limite para pagar/receber (planejamento, atrasos).
--   settled_at      : data em que o dinheiro efetivamente saiu/entrou (saldo).
-- Status:
--   forecast  previsto (ainda incerto)      pending  pendente (confirmado, não pago)
--   paid      pago (saída efetivada)        received recebido (entrada efetivada)
--   canceled  cancelado
--   "vencido" é derivado: forecast/pending com data de referência < hoje.

create table public.transactions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id           uuid,
  category_id          uuid,
  description          text not null check (char_length(btrim(description)) between 1 and 140),
  transaction_type     text not null check (transaction_type in ('income', 'expense', 'transfer', 'adjustment', 'reversal')),
  direction            text not null check (direction in ('in', 'out')),
  amount_cents         bigint not null check (amount_cents > 0 and amount_cents <= 100000000000000),
  settled_amount_cents bigint check (settled_amount_cents is null or (settled_amount_cents > 0 and settled_amount_cents <= 100000000000000)),
  status               text not null check (status in ('forecast', 'pending', 'paid', 'received', 'canceled')),
  competence_date      date not null default current_date,
  due_date             date,
  settled_at           date,
  -- Data exibida/filtrada: efetiva quando liquidado; senão vencimento; senão competência.
  ref_date             date generated always as (coalesce(settled_at, due_date, competence_date)) stored,
  payment_method       text check (payment_method is null or payment_method in
                         ('pix', 'debit', 'credit', 'cash', 'boleto', 'transfer', 'auto_debit', 'benefit_card', 'other')),
  tags                 text[] not null default '{}',
  notes                text check (notes is null or char_length(notes) <= 1000),
  transfer_group_id    uuid,
  reversal_of_id       uuid,
  reversed_at          timestamptz,
  archived_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  version              integer not null default 1,
  unique (id, user_id),
  foreign key (account_id, user_id)     references public.accounts (id, user_id),
  foreign key (category_id, user_id)    references public.categories (id, user_id),
  foreign key (reversal_of_id, user_id) references public.transactions (id, user_id),

  constraint tx_direction_matches_type check (
    (transaction_type = 'income' and direction = 'in')
    or (transaction_type = 'expense' and direction = 'out')
    or transaction_type in ('transfer', 'adjustment', 'reversal')),
  constraint tx_status_matches_direction check (
    status in ('forecast', 'pending', 'canceled')
    or (status = 'paid' and direction = 'out')
    or (status = 'received' and direction = 'in')),
  constraint tx_settlement_fields check (
    case when status in ('paid', 'received')
         then settled_at is not null and settled_amount_cents is not null and account_id is not null
         else settled_at is null and settled_amount_cents is null
    end),
  constraint tx_system_types_settled check (
    transaction_type in ('income', 'expense') or status in ('paid', 'received')),
  constraint tx_transfer_group check ((transaction_type = 'transfer') = (transfer_group_id is not null)),
  constraint tx_reversal_link check ((transaction_type = 'reversal') = (reversal_of_id is not null)),
  constraint tx_reversed_only_settled check (reversed_at is null or status in ('paid', 'received')),
  constraint tx_tags_limit check (cardinality(tags) <= 20),
  constraint tx_dates_sane check (
    competence_date between date '1900-01-01' and date '2200-12-31'
    and (due_date is null or due_date between date '1900-01-01' and date '2200-12-31')
    and (settled_at is null or settled_at between date '1900-01-01' and date '2200-12-31'))
);

create index transactions_open_idx on public.transactions (user_id, (coalesce(due_date, competence_date)))
  where status in ('forecast', 'pending');
create index transactions_settled_idx on public.transactions (user_id, settled_at)
  where status in ('paid', 'received');
create index transactions_account_idx on public.transactions (account_id) where account_id is not null;
create index transactions_category_idx on public.transactions (category_id) where category_id is not null;
create index transactions_competence_idx on public.transactions (user_id, competence_date);
create index transactions_ref_date_idx on public.transactions (user_id, ref_date desc);
create index transactions_transfer_idx on public.transactions (transfer_group_id) where transfer_group_id is not null;
create index transactions_reversal_idx on public.transactions (reversal_of_id) where reversal_of_id is not null;

-- -----------------------------------------------------------------------------
-- Idempotência e auditoria
-- -----------------------------------------------------------------------------

create table public.idempotency_keys (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key        uuid not null,
  operation  text not null,
  result     jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  entity_type text not null,
  entity_id   uuid not null,
  action      text not null,
  context     text,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);

create index audit_logs_user_idx on public.audit_logs (user_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_id);

create or replace function app_private.tg_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_user uuid := (v_row ->> 'user_id')::uuid;
begin
  -- Exclusão em cascata da conta do usuário: nada a auditar.
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = v_user) then
    return null;
  end if;
  insert into public.audit_logs (user_id, entity_type, entity_id, action, context, old_data, new_data)
  values (
    v_user,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    lower(tg_op),
    nullif(current_setting('app.audit_context', true), ''),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Regras de negócio (triggers)
-- -----------------------------------------------------------------------------

create or replace function app_private.tg_accounts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_has_tx boolean;
begin
  if tg_op = 'DELETE' then
    if app_private.is_api_role()
       and exists (select 1 from public.transactions t where t.account_id = old.id) then
      perform app_private.raise_business(
        'Esta conta possui lançamentos e não pode ser excluída.',
        'Desative a conta para ocultá-la sem perder o histórico.');
    end if;
    return old;
  end if;

  new.name := btrim(new.name);

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      perform app_private.raise_business('O proprietário da conta não pode ser alterado.');
    end if;
    if (new.opening_balance_cents, new.opening_date, new.currency_code, new.account_type = 'benefit')
       is distinct from (old.opening_balance_cents, old.opening_date, old.currency_code, old.account_type = 'benefit') then
      select exists (select 1 from public.transactions t where t.account_id = old.id) into v_has_tx;
      if v_has_tx then
        perform app_private.raise_business(
          'O saldo inicial, a data de abertura, a moeda e a natureza (benefício ou dinheiro) não podem ser alterados depois que a conta possui lançamentos.',
          'Use "Ajustar saldo" para registrar uma correção rastreável.');
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger accounts_guard before insert or update or delete on public.accounts
  for each row execute function app_private.tg_accounts_guard();
create trigger accounts_touch before update on public.accounts
  for each row execute function app_private.tg_touch();
create trigger accounts_audit after insert or update or delete on public.accounts
  for each row execute function app_private.tg_audit();

create or replace function app_private.tg_categories_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.categories;
begin
  if tg_op = 'DELETE' then
    if app_private.is_api_role() then
      if exists (select 1 from public.transactions t where t.category_id = old.id) then
        perform app_private.raise_business(
          'Esta categoria está em uso e não pode ser excluída.',
          'Desative a categoria para ocultá-la dos novos lançamentos.');
      end if;
      if exists (select 1 from public.categories c where c.parent_id = old.id) then
        perform app_private.raise_business('Exclua ou mova as subcategorias antes de excluir esta categoria.');
      end if;
    end if;
    return old;
  end if;

  new.name := btrim(new.name);

  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    perform app_private.raise_business('O proprietário da categoria não pode ser alterado.');
  end if;

  if new.parent_id is not null then
    select * into v_parent from public.categories c where c.id = new.parent_id and c.user_id = new.user_id;
    if not found then
      perform app_private.raise_business('Categoria principal não encontrada.');
    end if;
    if v_parent.parent_id is not null then
      perform app_private.raise_business('Subcategorias admitem apenas um nível.');
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.categories c where c.parent_id = new.id) then
      perform app_private.raise_business('Uma categoria com subcategorias não pode virar subcategoria.');
    end if;
  end if;
  return new;
end;
$$;

create trigger categories_guard before insert or update or delete on public.categories
  for each row execute function app_private.tg_categories_guard();
create trigger categories_touch before update on public.categories
  for each row execute function app_private.tg_touch();
create trigger categories_audit after insert or update or delete on public.categories
  for each row execute function app_private.tg_audit();

create or replace function app_private.tg_transactions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_privileged boolean := app_private.is_trusted_op() or not app_private.is_api_role();
  v_settled    boolean;
  v_was_settled boolean;
  v_acc        public.accounts;
  v_cat        public.categories;
  v_tag        text;
begin
  -- ---------------------------------------------------------------- DELETE
  if tg_op = 'DELETE' then
    if not v_privileged
       and (old.status in ('paid', 'received') or old.transaction_type not in ('income', 'expense')) then
      perform app_private.raise_business(
        'Lançamentos efetivados não podem ser excluídos.',
        'Utilize o estorno para corrigir mantendo o histórico.');
    end if;
    return old;
  end if;

  v_settled := new.status in ('paid', 'received');
  v_was_settled := tg_op = 'UPDATE' and old.status in ('paid', 'received');

  new.description := btrim(new.description);
  new.notes := nullif(btrim(new.notes), '');

  -- ---------------------------------------------------------------- fluxo
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    perform app_private.raise_business('O proprietário do lançamento não pode ser alterado.');
  end if;

  if not v_privileged then
    if tg_op = 'INSERT' then
      if new.transaction_type not in ('income', 'expense') then
        perform app_private.raise_business(
          'Transferências, ajustes e estornos devem ser criados pelas operações próprias.');
      end if;
      if new.reversed_at is not null or new.archived_at is not null then
        perform app_private.raise_business('Lançamento inválido.');
      end if;
    else
      if v_was_settled or old.transaction_type not in ('income', 'expense') then
        if (new.transaction_type, new.direction, new.amount_cents, new.settled_amount_cents, new.status,
            new.account_id, new.settled_at, new.transfer_group_id, new.reversal_of_id, new.reversed_at)
           is distinct from
           (old.transaction_type, old.direction, old.amount_cents, old.settled_amount_cents, old.status,
            old.account_id, old.settled_at, old.transfer_group_id, old.reversal_of_id, old.reversed_at) then
          perform app_private.raise_business(
            'Valores, conta, datas efetivas e status de um lançamento efetivado não podem ser alterados.',
            'Utilize o estorno para corrigir mantendo o histórico.');
        end if;
      else
        if v_settled then
          perform app_private.raise_business(
            'Use a operação "Confirmar pagamento/recebimento" para efetivar um lançamento.');
        end if;
        if new.transaction_type not in ('income', 'expense')
           or (new.transfer_group_id, new.reversal_of_id, new.reversed_at)
              is distinct from (old.transfer_group_id, old.reversal_of_id, old.reversed_at) then
          perform app_private.raise_business('Alteração não permitida.');
        end if;
      end if;
    end if;

    if new.archived_at is not null
       and (tg_op = 'INSERT' or old.archived_at is null)
       and new.status in ('forecast', 'pending') then
      perform app_private.raise_business(
        'Somente lançamentos efetivados ou cancelados podem ser arquivados.',
        'Lançamentos em aberto continuam compondo o planejamento.');
    end if;
  end if;

  -- ---------------------------------------------------------------- validações
  if new.account_id is not null
     and (tg_op = 'INSERT'
          or new.account_id is distinct from old.account_id
          or (v_settled and not v_was_settled)) then
    select * into v_acc from public.accounts a where a.id = new.account_id and a.user_id = new.user_id;
    if not found then
      perform app_private.raise_business('Conta não encontrada.');
    end if;
    if not v_acc.is_active then
      perform app_private.raise_business('A conta selecionada está desativada.');
    end if;
    if v_settled and new.settled_at < v_acc.opening_date then
      perform app_private.raise_business(
        format('A data efetiva não pode ser anterior à data do saldo inicial da conta (%s).',
               to_char(v_acc.opening_date, 'DD/MM/YYYY')),
        'Movimentos anteriores já estão refletidos no saldo inicial.');
    end if;
  end if;

  if v_settled and not v_was_settled and new.settled_at > current_date + 1 then
    perform app_private.raise_business('A data efetiva de pagamento/recebimento não pode estar no futuro.');
  end if;

  if new.category_id is not null
     and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id
          or new.transaction_type is distinct from old.transaction_type) then
    select * into v_cat from public.categories c where c.id = new.category_id and c.user_id = new.user_id;
    if not found then
      perform app_private.raise_business('Categoria não encontrada.');
    end if;
    if (tg_op = 'INSERT' or new.category_id is distinct from old.category_id) and not v_cat.is_active then
      perform app_private.raise_business('A categoria selecionada está desativada.');
    end if;
    if new.transaction_type in ('income', 'expense')
       and v_cat.category_type <> 'both' and v_cat.category_type <> new.transaction_type then
      perform app_private.raise_business(
        case new.transaction_type when 'income' then 'Esta categoria é de despesas.' else 'Esta categoria é de receitas.' end);
    end if;
  end if;

  foreach v_tag in array new.tags loop
    if v_tag is null or char_length(v_tag) not between 1 and 30 then
      perform app_private.raise_business('Cada etiqueta deve ter entre 1 e 30 caracteres.');
    end if;
  end loop;

  return new;
end;
$$;

create trigger transactions_guard before insert or update or delete on public.transactions
  for each row execute function app_private.tg_transactions_guard();
create trigger transactions_touch before update on public.transactions
  for each row execute function app_private.tg_touch();
create trigger transactions_audit after insert or update or delete on public.transactions
  for each row execute function app_private.tg_audit();

-- -----------------------------------------------------------------------------
-- Saldos derivados
-- -----------------------------------------------------------------------------

create view public.account_balances
with (security_invoker = true)
as
select
  a.id as account_id,
  a.user_id,
  a.name,
  a.institution_name,
  a.account_type,
  a.currency_code,
  a.is_active,
  a.opening_balance_cents,
  a.opening_date,
  (a.opening_balance_cents
    + coalesce(sum(case t.direction when 'in' then t.settled_amount_cents else -t.settled_amount_cents end)
               filter (where t.status in ('paid', 'received')), 0))::bigint as balance_cents,
  max(t.settled_at) filter (where t.status in ('paid', 'received')) as last_movement_at
from public.accounts a
left join public.transactions t on t.account_id = a.id and t.user_id = a.user_id
group by a.id;

-- -----------------------------------------------------------------------------
-- Novo usuário: perfil + categorias iniciais
-- -----------------------------------------------------------------------------

create or replace function app_private.seed_default_categories(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.categories (user_id, name, category_type, color, is_essential, sort_order)
  values
    (p_user, 'Moradia',               'expense', '#f97316', true,  10),
    (p_user, 'Alimentação',           'expense', '#eab308', true,  20),
    (p_user, 'Transporte',            'expense', '#06b6d4', true,  30),
    (p_user, 'Saúde',                 'expense', '#ef4444', true,  40),
    (p_user, 'Educação',              'expense', '#8b5cf6', true,  50),
    (p_user, 'Filhos e família',      'expense', '#ec4899', true,  60),
    (p_user, 'Serviços essenciais',   'expense', '#0ea5e9', true,  70),
    (p_user, 'Dívidas e empréstimos', 'expense', '#dc2626', false, 80),
    (p_user, 'Cartões de crédito',    'expense', '#f43f5e', false, 90),
    (p_user, 'Lazer',                 'expense', '#a3e635', false, 100),
    (p_user, 'Assinaturas',           'expense', '#64748b', false, 110),
    (p_user, 'Salário',               'income',  '#22c55e', false, 120),
    (p_user, 'Benefícios',            'income',  '#10b981', false, 130),
    (p_user, 'Renda extra',           'income',  '#84cc16', false, 140),
    (p_user, 'Outros',                'both',    '#9ca3af', false, 150)
  on conflict do nothing;
end;
$$;

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80), ''))
  on conflict (id) do nothing;
  perform app_private.seed_default_categories(new.id);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Idempotência
-- -----------------------------------------------------------------------------

-- Retorna NULL quando a chave é nova (a operação deve ser executada) ou o
-- resultado armazenado quando a mesma solicitação já foi concluída. Chamadas
-- concorrentes com a mesma chave aguardam a primeira terminar.
create or replace function app_private.idem_begin(p_key uuid, p_operation text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.idempotency_keys;
begin
  if p_key is null then
    perform app_private.raise_business('Chave de idempotência obrigatória.');
  end if;
  insert into public.idempotency_keys (user_id, key, operation)
  values (auth.uid(), p_key, p_operation)
  on conflict (user_id, key) do nothing;
  if found then
    return null;
  end if;
  select * into v_row from public.idempotency_keys k where k.user_id = auth.uid() and k.key = p_key;
  if v_row.operation <> p_operation then
    perform app_private.raise_business('Chave de idempotência já utilizada em outra operação.');
  end if;
  return coalesce(v_row.result, '{}'::jsonb);
end;
$$;

create or replace function app_private.idem_finish(p_key uuid, p_result jsonb)
returns void
language sql
set search_path = ''
as $$
  update public.idempotency_keys set result = p_result where user_id = auth.uid() and key = p_key;
$$;

create or replace function app_private.begin_trusted(p_context text)
returns void
language sql
set search_path = ''
as $$
  select set_config('app.trusted_op', 'on', true), set_config('app.audit_context', p_context, true);
$$;

create or replace function app_private.end_trusted()
returns void
language sql
set search_path = ''
as $$
  select set_config('app.trusted_op', '', true), set_config('app.audit_context', '', true);
$$;

-- -----------------------------------------------------------------------------
-- RPC: confirmar pagamento / recebimento
-- -----------------------------------------------------------------------------

create or replace function public.settle_transaction(
  p_transaction_id  uuid,
  p_account_id      uuid,
  p_settled_at      date,
  p_amount_cents    bigint,
  p_idempotency_key uuid)
returns public.transactions
language plpgsql
set search_path = ''
as $$
declare
  v_prev jsonb;
  v_tx   public.transactions;
begin
  perform app_private.require_user();
  v_prev := app_private.idem_begin(p_idempotency_key, 'settle_transaction');
  if v_prev is not null then
    select * into v_tx from public.transactions t where t.id = (v_prev ->> 'transaction_id')::uuid;
    return v_tx;
  end if;

  if p_account_id is null then
    perform app_private.raise_business('Informe a conta utilizada.');
  end if;
  if p_settled_at is null then
    perform app_private.raise_business('Informe a data efetiva.');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    perform app_private.raise_business('O valor deve ser maior que zero.');
  end if;

  perform app_private.begin_trusted('settle');
  -- O UPDATE condicional bloqueia a linha; uma confirmação concorrente aguarda
  -- e, ao reavaliar o filtro de status, não encontra mais o lançamento em aberto.
  update public.transactions t
     set status = case t.direction when 'out' then 'paid' else 'received' end,
         account_id = p_account_id,
         settled_at = p_settled_at,
         settled_amount_cents = p_amount_cents
   where t.id = p_transaction_id
     and t.status in ('forecast', 'pending')
     and t.transaction_type in ('income', 'expense')
  returning * into v_tx;

  if not found then
    if exists (select 1 from public.transactions t where t.id = p_transaction_id) then
      perform app_private.raise_business('Este lançamento já foi efetivado ou está cancelado.');
    end if;
    perform app_private.raise_business('Lançamento não encontrado.');
  end if;
  perform app_private.end_trusted();

  perform app_private.idem_finish(p_idempotency_key, jsonb_build_object('transaction_id', v_tx.id));
  return v_tx;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: transferência entre contas próprias
-- -----------------------------------------------------------------------------

create or replace function public.create_transfer(
  p_from_account_id uuid,
  p_to_account_id   uuid,
  p_amount_cents    bigint,
  p_date            date,
  p_description     text,
  p_idempotency_key uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_uid   uuid := app_private.require_user();
  v_prev  jsonb;
  v_group uuid := gen_random_uuid();
  v_from  public.accounts;
  v_to    public.accounts;
  v_desc  text := coalesce(nullif(btrim(p_description), ''), 'Transferência');
begin
  v_prev := app_private.idem_begin(p_idempotency_key, 'create_transfer');
  if v_prev is not null then
    return (v_prev ->> 'transfer_group_id')::uuid;
  end if;

  if p_from_account_id is null or p_to_account_id is null or p_from_account_id = p_to_account_id then
    perform app_private.raise_business('Escolha duas contas diferentes.');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    perform app_private.raise_business('O valor deve ser maior que zero.');
  end if;
  if p_date is null then
    perform app_private.raise_business('Informe a data da transferência.');
  end if;

  select * into v_from from public.accounts a where a.id = p_from_account_id;
  select * into v_to from public.accounts a where a.id = p_to_account_id;
  if v_from.id is null or v_to.id is null then
    perform app_private.raise_business('Conta não encontrada.');
  end if;
  if (v_from.account_type = 'benefit') <> (v_to.account_type = 'benefit') then
    perform app_private.raise_business(
      'Saldos de benefícios de uso restrito não podem ser transferidos para contas de dinheiro (nem o contrário).');
  end if;
  if v_from.currency_code <> v_to.currency_code then
    perform app_private.raise_business('As contas possuem moedas diferentes.');
  end if;

  perform app_private.begin_trusted('transfer');
  insert into public.transactions (user_id, account_id, description, transaction_type, direction, amount_cents,
                                   settled_amount_cents, status, competence_date, settled_at, payment_method, transfer_group_id)
  values
    (v_uid, p_from_account_id, v_desc, 'transfer', 'out', p_amount_cents, p_amount_cents, 'paid',
     p_date, p_date, 'transfer', v_group),
    (v_uid, p_to_account_id, v_desc, 'transfer', 'in', p_amount_cents, p_amount_cents, 'received',
     p_date, p_date, 'transfer', v_group);
  perform app_private.end_trusted();

  perform app_private.idem_finish(p_idempotency_key, jsonb_build_object('transfer_group_id', v_group));
  return v_group;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: ajuste de saldo (correção rastreável)
-- -----------------------------------------------------------------------------

create or replace function public.adjust_account_balance(
  p_account_id           uuid,
  p_target_balance_cents bigint,
  p_date                 date,
  p_reason               text,
  p_idempotency_key      uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_uid     uuid := app_private.require_user();
  v_prev    jsonb;
  v_current bigint;
  v_diff    bigint;
  v_id      uuid;
begin
  v_prev := app_private.idem_begin(p_idempotency_key, 'adjust_account_balance');
  if v_prev is not null then
    return (v_prev ->> 'transaction_id')::uuid;
  end if;

  if p_target_balance_cents is null or abs(p_target_balance_cents) > 100000000000000 then
    perform app_private.raise_business('Saldo informado inválido.');
  end if;
  if p_date is null then
    perform app_private.raise_business('Informe a data do ajuste.');
  end if;

  -- Serializa ajustes concorrentes na mesma conta.
  perform 1 from public.accounts a where a.id = p_account_id for update;
  if not found then
    perform app_private.raise_business('Conta não encontrada.');
  end if;

  select b.balance_cents into v_current from public.account_balances b where b.account_id = p_account_id;
  v_diff := p_target_balance_cents - v_current;
  if v_diff = 0 then
    perform app_private.raise_business('O saldo informado é igual ao saldo atual.');
  end if;

  perform app_private.begin_trusted('adjust');
  insert into public.transactions (user_id, account_id, description, transaction_type, direction, amount_cents,
                                   settled_amount_cents, status, competence_date, settled_at, notes)
  values (v_uid, p_account_id, 'Ajuste de saldo', 'adjustment',
          case when v_diff > 0 then 'in' else 'out' end, abs(v_diff), abs(v_diff),
          case when v_diff > 0 then 'received' else 'paid' end,
          p_date, p_date, nullif(btrim(p_reason), ''))
  returning id into v_id;
  perform app_private.end_trusted();

  perform app_private.idem_finish(p_idempotency_key, jsonb_build_object('transaction_id', v_id));
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: estorno (corrige um lançamento efetivado sem apagar o histórico)
-- -----------------------------------------------------------------------------

create or replace function public.reverse_transaction(
  p_transaction_id  uuid,
  p_reason          text,
  p_reopen          boolean,
  p_idempotency_key uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid      uuid := app_private.require_user();
  v_prev     jsonb;
  v_tx       public.transactions;
  v_leg      public.transactions;
  v_today    date := app_private.user_today();
  v_rev_ids  uuid[] := '{}';
  v_rev_id   uuid;
  v_reopened uuid;
begin
  v_prev := app_private.idem_begin(p_idempotency_key, 'reverse_transaction');
  if v_prev is not null then
    return v_prev;
  end if;

  select * into v_tx from public.transactions t where t.id = p_transaction_id for update;
  if not found then
    perform app_private.raise_business('Lançamento não encontrado.');
  end if;
  if v_tx.transaction_type = 'reversal' then
    perform app_private.raise_business('Um estorno não pode ser estornado.');
  end if;
  if v_tx.status not in ('paid', 'received') then
    perform app_private.raise_business(
      'Somente lançamentos efetivados podem ser estornados.',
      'Lançamentos em aberto podem ser editados, cancelados ou excluídos.');
  end if;
  if v_tx.reversed_at is not null then
    perform app_private.raise_business('Este lançamento já foi estornado.');
  end if;

  perform app_private.begin_trusted('reverse');
  for v_leg in
    select * from public.transactions t
     where (v_tx.transfer_group_id is not null and t.transfer_group_id = v_tx.transfer_group_id)
        or t.id = v_tx.id
     order by t.id
     for update
  loop
    if v_leg.reversed_at is not null then
      perform app_private.raise_business('Este lançamento já foi estornado.');
    end if;
    insert into public.transactions (user_id, account_id, description, transaction_type, direction, amount_cents,
                                     settled_amount_cents, status, competence_date, settled_at, notes, reversal_of_id)
    values (v_uid, v_leg.account_id, left('Estorno: ' || v_leg.description, 140), 'reversal',
            case v_leg.direction when 'in' then 'out' else 'in' end,
            v_leg.settled_amount_cents, v_leg.settled_amount_cents,
            case v_leg.direction when 'in' then 'paid' else 'received' end,
            greatest(v_today, v_leg.settled_at), greatest(v_today, v_leg.settled_at),
            nullif(btrim(p_reason), ''), v_leg.id)
    returning id into v_rev_id;
    v_rev_ids := v_rev_ids || v_rev_id;
    update public.transactions t set reversed_at = now() where t.id = v_leg.id;
  end loop;

  if coalesce(p_reopen, false) and v_tx.transaction_type in ('income', 'expense') then
    insert into public.transactions (user_id, account_id, category_id, description, transaction_type, direction,
                                     amount_cents, status, competence_date, due_date, payment_method, tags, notes)
    values (v_uid, v_tx.account_id, v_tx.category_id, v_tx.description, v_tx.transaction_type, v_tx.direction,
            v_tx.amount_cents, 'pending', v_tx.competence_date, coalesce(v_tx.due_date, v_tx.settled_at),
            v_tx.payment_method, v_tx.tags, v_tx.notes)
    returning id into v_reopened;
  end if;
  perform app_private.end_trusted();

  v_prev := jsonb_build_object('reversal_ids', to_jsonb(v_rev_ids), 'reopened_id', v_reopened);
  perform app_private.idem_finish(p_idempotency_key, v_prev);
  return v_prev;
end;
$$;

-- -----------------------------------------------------------------------------
-- Resumo financeiro da tela inicial
-- -----------------------------------------------------------------------------
-- Saldo bancário  = soma dos saldos efetivos das contas ativas de dinheiro.
-- Comprometido    = despesas em aberto (pendentes [+ previstas]) com data de
--                   referência até o fim do período, inclusive vencidas.
-- Livre estimado  = bancário − comprometido + entradas consideradas no cenário.
-- Projetado       = bancário + todas as entradas em aberto − todas as saídas em
--                   aberto até o fim do período.
-- Lançamentos vinculados a contas de benefício não entram no dinheiro livre.

create or replace function public.financial_summary(
  p_start                      date,
  p_end                        date,
  p_account_ids                uuid[]  default null,
  p_include_forecast_expenses  boolean default true,
  p_include_pending_income     boolean default false,
  p_include_forecast_income    boolean default false)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today  date := app_private.user_today();
  v_result jsonb;
begin
  perform app_private.require_user();
  if p_start is null or p_end is null or p_end < p_start then
    perform app_private.raise_business('Período inválido.');
  end if;
  if p_end - p_start > 3700 then
    perform app_private.raise_business('Período muito longo.');
  end if;

  with acc as (
    select b.*
      from public.account_balances b
     where b.is_active
       and (p_account_ids is null or b.account_id = any (p_account_ids))
  ),
  open_items as (
    select t.transaction_type, t.status, t.amount_cents,
           coalesce(t.due_date, t.competence_date) as ref_date
      from public.transactions t
      left join public.accounts a on a.id = t.account_id
     where t.status in ('forecast', 'pending')
       and t.transaction_type in ('income', 'expense')
       and (a.id is null or a.account_type <> 'benefit')
       and (p_account_ids is null or t.account_id is null or t.account_id = any (p_account_ids))
  ),
  settled as (
    select t.transaction_type, t.settled_amount_cents as amount_cents
      from public.transactions t
     where t.status in ('paid', 'received')
       and t.transaction_type in ('income', 'expense')
       and t.reversed_at is null
       and t.settled_at between p_start and p_end
       and (p_account_ids is null or t.account_id = any (p_account_ids))
  ),
  o as (
    select
      coalesce(sum(amount_cents) filter (where transaction_type = 'expense' and status = 'pending' and ref_date <= p_end), 0) as exp_pending_upto,
      coalesce(sum(amount_cents) filter (where transaction_type = 'expense' and status = 'forecast' and ref_date <= p_end), 0) as exp_forecast_upto,
      coalesce(sum(amount_cents) filter (where transaction_type = 'income' and status = 'pending' and ref_date <= p_end), 0) as inc_pending_upto,
      coalesce(sum(amount_cents) filter (where transaction_type = 'income' and status = 'forecast' and ref_date <= p_end), 0) as inc_forecast_upto,
      coalesce(sum(amount_cents) filter (where transaction_type = 'expense' and status = 'pending' and ref_date between p_start and p_end), 0) as exp_pending_period,
      coalesce(sum(amount_cents) filter (where transaction_type = 'expense' and status = 'forecast' and ref_date between p_start and p_end), 0) as exp_forecast_period,
      coalesce(sum(amount_cents) filter (where transaction_type = 'income' and status = 'pending' and ref_date between p_start and p_end), 0) as inc_pending_period,
      coalesce(sum(amount_cents) filter (where transaction_type = 'income' and status = 'forecast' and ref_date between p_start and p_end), 0) as inc_forecast_period,
      coalesce(sum(amount_cents) filter (where transaction_type = 'expense' and ref_date < v_today), 0) as exp_overdue,
      count(*) filter (where transaction_type = 'expense' and ref_date < v_today) as exp_overdue_count,
      coalesce(sum(amount_cents) filter (where transaction_type = 'income' and ref_date < v_today), 0) as inc_late,
      count(*) filter (where transaction_type = 'income' and ref_date < v_today) as inc_late_count
    from open_items
  ),
  s as (
    select
      coalesce(sum(amount_cents) filter (where transaction_type = 'expense'), 0) as exp_paid,
      coalesce(sum(amount_cents) filter (where transaction_type = 'income'), 0) as inc_received
    from settled
  ),
  b as (
    select
      coalesce(sum(balance_cents) filter (where account_type <> 'benefit'), 0) as bank,
      coalesce(sum(balance_cents) filter (where account_type = 'benefit'), 0) as benefit
    from acc
  )
  select jsonb_build_object(
    'today', v_today,
    'period_start', p_start,
    'period_end', p_end,
    'bank_balance_cents', b.bank,
    'benefit_balance_cents', b.benefit,
    'committed_cents', o.exp_pending_upto + case when p_include_forecast_expenses then o.exp_forecast_upto else 0 end,
    'considered_income_cents',
        case when p_include_pending_income then o.inc_pending_upto else 0 end
      + case when p_include_forecast_income then o.inc_forecast_upto else 0 end,
    'free_cents', b.bank
      - (o.exp_pending_upto + case when p_include_forecast_expenses then o.exp_forecast_upto else 0 end)
      + case when p_include_pending_income then o.inc_pending_upto else 0 end
      + case when p_include_forecast_income then o.inc_forecast_upto else 0 end,
    'projected_end_cents', b.bank + o.inc_pending_upto + o.inc_forecast_upto - o.exp_pending_upto - o.exp_forecast_upto,
    'projection_uncertain_income_cents', o.inc_forecast_upto,
    'expenses', jsonb_build_object(
      'paid_cents', s.exp_paid,
      'pending_cents', o.exp_pending_period,
      'forecast_cents', o.exp_forecast_period,
      'overdue_cents', o.exp_overdue,
      'overdue_count', o.exp_overdue_count),
    'income', jsonb_build_object(
      'received_cents', s.inc_received,
      'pending_cents', o.inc_pending_period,
      'forecast_cents', o.inc_forecast_period,
      'late_cents', o.inc_late,
      'late_count', o.inc_late_count)
  ) into v_result
  from o, s, b;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.accounts         enable row level security;
alter table public.categories       enable row level security;
alter table public.transactions     enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.audit_logs       enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy accounts_select on public.accounts for select to authenticated using (user_id = (select auth.uid()));
create policy accounts_insert on public.accounts for insert to authenticated with check (user_id = (select auth.uid()));
create policy accounts_update on public.accounts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy accounts_delete on public.accounts for delete to authenticated using (user_id = (select auth.uid()));

create policy categories_select on public.categories for select to authenticated using (user_id = (select auth.uid()));
create policy categories_insert on public.categories for insert to authenticated with check (user_id = (select auth.uid()));
create policy categories_update on public.categories for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy categories_delete on public.categories for delete to authenticated using (user_id = (select auth.uid()));

create policy transactions_select on public.transactions for select to authenticated using (user_id = (select auth.uid()));
create policy transactions_insert on public.transactions for insert to authenticated with check (user_id = (select auth.uid()));
create policy transactions_update on public.transactions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy transactions_delete on public.transactions for delete to authenticated using (user_id = (select auth.uid()));

create policy idempotency_select on public.idempotency_keys for select to authenticated using (user_id = (select auth.uid()));
create policy idempotency_insert on public.idempotency_keys for insert to authenticated with check (user_id = (select auth.uid()));
create policy idempotency_update on public.idempotency_keys for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy audit_logs_select on public.audit_logs for select to authenticated using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Privilégios: nada para anônimos; funções internas fora da API.
-- -----------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
revoke all on all functions in schema app_private from anon, public;

revoke insert, update, delete on public.audit_logs from authenticated;
revoke delete on public.idempotency_keys from authenticated;
revoke insert, delete on public.profiles from authenticated;

grant select, insert, update, delete on public.accounts, public.categories, public.transactions to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.audit_logs, public.account_balances to authenticated;
grant select, insert, update on public.idempotency_keys to authenticated;

grant execute on function
  app_private.is_api_role(), app_private.is_trusted_op(), app_private.require_user(),
  app_private.raise_business(text, text), app_private.user_today(),
  app_private.idem_begin(uuid, text), app_private.idem_finish(uuid, jsonb),
  app_private.begin_trusted(text), app_private.end_trusted(),
  app_private.tg_touch(), app_private.tg_accounts_guard(), app_private.tg_categories_guard(),
  app_private.tg_transactions_guard(), app_private.tg_profiles_guard(), app_private.tg_audit()
  to authenticated;

grant execute on function
  public.settle_transaction(uuid, uuid, date, bigint, uuid),
  public.create_transfer(uuid, uuid, bigint, date, text, uuid),
  public.adjust_account_balance(uuid, bigint, date, text, uuid),
  public.reverse_transaction(uuid, text, boolean, uuid),
  public.financial_summary(date, date, uuid[], boolean, boolean, boolean)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime (sincronização entre dispositivos). Respeita RLS no Supabase.
-- -----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.accounts, public.categories, public.transactions, public.profiles;
  end if;
end;
$$;
