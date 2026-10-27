-- =============================================================================
-- Financeiro Pessoal Inteligente — Fase 2 (Controle de dívidas)
--
-- Saldo devedor nunca é editado diretamente. Ele é derivado de:
--   principal em aberto = valor original − Σ principal pago
--   encargos em aberto  = max(0, Σ encargos lançados − Σ descontos − Σ encargos pagos)
-- Pagamentos de dívida geram, na mesma transação, a saída bancária (despesa
-- paga) e o registro em debt_payments. Estornar essa saída anula o pagamento.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- debts
-- -----------------------------------------------------------------------------

create table public.debts (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  creditor_name            text not null check (char_length(btrim(creditor_name)) between 1 and 80),
  description              text check (description is null or char_length(description) <= 140),
  original_amount_cents    bigint not null check (original_amount_cents > 0 and original_amount_cents <= 100000000000000),
  contracted_amount_cents  bigint check (contracted_amount_cents is null or contracted_amount_cents > 0),
  minimum_payment_cents    bigint check (minimum_payment_cents is null or minimum_payment_cents > 0),
  installment_amount_cents bigint check (installment_amount_cents is null or installment_amount_cents > 0),
  installments_total       integer check (installments_total is null or installments_total between 1 and 600),
  next_due_date            date check (next_due_date is null or next_due_date between date '1900-01-01' and date '2200-12-31'),
  interest_rate_monthly    numeric(7, 4) check (interest_rate_monthly is null or interest_rate_monthly between 0 and 100),
  late_fee_percent         numeric(7, 4) check (late_fee_percent is null or late_fee_percent between 0 and 100),
  category_id              uuid,
  account_id               uuid,
  priority_level           text not null default 'medium' check (priority_level in ('critical', 'high', 'medium', 'low')),
  priority_rank            integer not null default 0,
  is_essential             boolean not null default false,
  late_consequence         text not null default 'none' check (late_consequence in
                             ('service_cut', 'asset_loss', 'personal_trust', 'legal_action', 'credit_restriction',
                              'high_interest', 'other', 'none')),
  consequence_notes        text check (consequence_notes is null or char_length(consequence_notes) <= 500),
  debt_status              text not null default 'active' check (debt_status in ('active', 'paid_off', 'archived')),
  notes                    text check (notes is null or char_length(notes) <= 1000),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  version                  integer not null default 1,
  unique (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id),
  foreign key (account_id, user_id) references public.accounts (id, user_id)
);

create index debts_user_rank_idx on public.debts (user_id, priority_rank);
create index debts_due_idx on public.debts (user_id, next_due_date) where debt_status = 'active';

comment on column public.debts.original_amount_cents is
  'Saldo devedor de partida (quando a dívida foi cadastrada). Base do saldo derivado.';
comment on column public.debts.contracted_amount_cents is 'Valor originalmente contratado (informativo).';
comment on column public.debts.interest_rate_monthly is 'Juros em % ao mês, quando conhecidos.';
comment on column public.debts.late_consequence is
  'service_cut = corte de serviço essencial; asset_loss = perda de bem/moradia; personal_trust = dívida com pessoa '
  '(confiança/relação); legal_action = cobrança judicial; '
  'credit_restriction = negativação; high_interest = juros altos; other; none.';

-- -----------------------------------------------------------------------------
-- debt_charges — juros, multas, tarifas e descontos (rastreáveis, imutáveis)
-- -----------------------------------------------------------------------------

create table public.debt_charges (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  debt_id      uuid not null,
  charge_kind  text not null check (charge_kind in ('interest', 'fine', 'fee', 'discount')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000000),
  charge_date  date not null,
  description  text check (description is null or char_length(description) <= 140),
  created_at   timestamptz not null default now(),
  foreign key (debt_id, user_id) references public.debts (id, user_id) on delete cascade
);

create index debt_charges_debt_idx on public.debt_charges (debt_id);

-- -----------------------------------------------------------------------------
-- debt_payments — histórico de pagamentos (imutável; estorno marca reversed_at)
-- -----------------------------------------------------------------------------

create table public.debt_payments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  debt_id         uuid not null,
  transaction_id  uuid not null,
  amount_cents    bigint not null check (amount_cents > 0),
  principal_cents bigint not null check (principal_cents >= 0),
  charges_cents   bigint not null check (charges_cents >= 0),
  payment_date    date not null,
  notes           text check (notes is null or char_length(notes) <= 500),
  reversed_at     timestamptz,
  created_at      timestamptz not null default now(),
  check (amount_cents = principal_cents + charges_cents),
  unique (transaction_id),
  foreign key (debt_id, user_id) references public.debts (id, user_id) on delete cascade,
  foreign key (transaction_id, user_id) references public.transactions (id, user_id)
);

create index debt_payments_debt_idx on public.debt_payments (debt_id, payment_date desc);

-- -----------------------------------------------------------------------------
-- Saldos derivados
-- -----------------------------------------------------------------------------

create view public.debt_balances
with (security_invoker = true)
as
with p as (
  select debt_id,
         coalesce(sum(principal_cents) filter (where reversed_at is null), 0) as principal_paid,
         coalesce(sum(charges_cents) filter (where reversed_at is null), 0) as charges_paid,
         coalesce(sum(amount_cents) filter (where reversed_at is null), 0) as total_paid,
         max(payment_date) filter (where reversed_at is null) as last_payment_at,
         count(*) filter (where reversed_at is null) as payments_count
    from public.debt_payments
   group by debt_id
),
c as (
  select debt_id,
         coalesce(sum(amount_cents) filter (where charge_kind <> 'discount'), 0) as charges_added,
         coalesce(sum(amount_cents) filter (where charge_kind = 'discount'), 0) as discounts
    from public.debt_charges
   group by debt_id
)
select
  d.id as debt_id,
  d.user_id,
  d.original_amount_cents,
  coalesce(p.principal_paid, 0)::bigint as principal_paid_cents,
  coalesce(p.charges_paid, 0)::bigint as charges_paid_cents,
  coalesce(p.total_paid, 0)::bigint as total_paid_cents,
  coalesce(c.charges_added, 0)::bigint as charges_added_cents,
  coalesce(c.discounts, 0)::bigint as discounts_cents,
  greatest(0, d.original_amount_cents - coalesce(p.principal_paid, 0))::bigint as principal_outstanding_cents,
  greatest(0, coalesce(c.charges_added, 0) - coalesce(c.discounts, 0) - coalesce(p.charges_paid, 0))::bigint
    as charges_outstanding_cents,
  (greatest(0, d.original_amount_cents - coalesce(p.principal_paid, 0))
   + greatest(0, coalesce(c.charges_added, 0) - coalesce(c.discounts, 0) - coalesce(p.charges_paid, 0)))::bigint
    as outstanding_cents,
  p.last_payment_at,
  coalesce(p.payments_count, 0)::integer as payments_count
from public.debts d
left join p on p.debt_id = d.id
left join c on c.debt_id = d.id;

-- Valor devido no próximo vencimento: parcela, senão mínimo, senão o saldo todo.
create or replace function app_private.debt_amount_due(p_debt public.debts, p_outstanding bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select least(p_outstanding, coalesce(p_debt.installment_amount_cents, p_debt.minimum_payment_cents, p_outstanding));
$$;

-- -----------------------------------------------------------------------------
-- Regras (triggers)
-- -----------------------------------------------------------------------------

create or replace function app_private.tg_debts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_privileged boolean := app_private.is_trusted_op() or not app_private.is_api_role();
  v_has_payments boolean;
  v_outstanding bigint;
  v_cat public.categories;
begin
  if tg_op = 'DELETE' then
    if app_private.is_api_role()
       and exists (select 1 from public.debt_payments p where p.debt_id = old.id) then
      perform app_private.raise_business(
        'Esta dívida possui pagamentos registrados e não pode ser excluída.',
        'Arquive-a para ocultá-la mantendo o histórico.');
    end if;
    return old;
  end if;

  new.creditor_name := btrim(new.creditor_name);
  new.description := nullif(btrim(new.description), '');

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      perform app_private.raise_business('O proprietário da dívida não pode ser alterado.');
    end if;
    if new.original_amount_cents is distinct from old.original_amount_cents then
      select exists (select 1 from public.debt_payments p where p.debt_id = old.id) into v_has_payments;
      if v_has_payments then
        perform app_private.raise_business(
          'O valor original não pode ser alterado depois de registrar pagamentos.',
          'Use "Registrar encargo" ou "Desconto" para corrigir o saldo de forma rastreável.');
      end if;
    end if;
    if not v_privileged and new.debt_status = 'paid_off' and old.debt_status <> 'paid_off' then
      select b.outstanding_cents into v_outstanding from public.debt_balances b where b.debt_id = new.id;
      if coalesce(v_outstanding, 1) > 0 then
        perform app_private.raise_business('A dívida só é quitada quando o saldo devedor chega a zero.');
      end if;
    end if;
  elsif not v_privileged and new.debt_status = 'paid_off' then
    perform app_private.raise_business('Uma dívida nova não pode começar quitada.');
  end if;

  if new.category_id is not null
     and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id) then
    select * into v_cat from public.categories c where c.id = new.category_id and c.user_id = new.user_id;
    if not found then
      perform app_private.raise_business('Categoria não encontrada.');
    end if;
    if v_cat.category_type = 'income' then
      perform app_private.raise_business('Escolha uma categoria de despesa.');
    end if;
  end if;

  if new.account_id is not null
     and (tg_op = 'INSERT' or new.account_id is distinct from old.account_id)
     and not exists (select 1 from public.accounts a where a.id = new.account_id and a.user_id = new.user_id) then
    perform app_private.raise_business('Conta não encontrada.');
  end if;

  if tg_op = 'INSERT' and new.priority_rank = 0 then
    select coalesce(max(d.priority_rank), 0) + 1 into new.priority_rank
      from public.debts d where d.user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger debts_guard before insert or update or delete on public.debts
  for each row execute function app_private.tg_debts_guard();
create trigger debts_touch before update on public.debts
  for each row execute function app_private.tg_touch();
create trigger debts_audit after insert or update or delete on public.debts
  for each row execute function app_private.tg_audit();

-- Encargos e pagamentos só nascem pelas operações próprias e não são editados.
create or replace function app_private.tg_debt_history_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app_private.is_trusted_op() or not app_private.is_api_role() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  perform app_private.raise_business('O histórico da dívida só pode ser alterado pelas operações próprias.');
  return null;
end;
$$;

create trigger debt_charges_guard before insert or update or delete on public.debt_charges
  for each row execute function app_private.tg_debt_history_guard();
create trigger debt_payments_guard before insert or update or delete on public.debt_payments
  for each row execute function app_private.tg_debt_history_guard();
create trigger debt_charges_audit after insert or update or delete on public.debt_charges
  for each row execute function app_private.tg_audit();
create trigger debt_payments_audit after insert or update or delete on public.debt_payments
  for each row execute function app_private.tg_audit();

-- Estorno da saída bancária anula o pagamento da dívida e reabre a dívida.
create or replace function app_private.tg_transactions_debt_reversal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_debt_id uuid;
begin
  if new.reversed_at is not null and old.reversed_at is null then
    update public.debt_payments p set reversed_at = new.reversed_at
     where p.transaction_id = new.id and p.reversed_at is null
    returning p.debt_id into v_debt_id;
    if v_debt_id is not null then
      update public.debts d set debt_status = 'active'
       where d.id = v_debt_id and d.debt_status = 'paid_off';
    end if;
  end if;
  return null;
end;
$$;

create trigger transactions_debt_reversal after update of reversed_at on public.transactions
  for each row execute function app_private.tg_transactions_debt_reversal();

-- -----------------------------------------------------------------------------
-- RPC: pagar dívida (integral ou parcial)
-- -----------------------------------------------------------------------------

create or replace function public.pay_debt(
  p_debt_id         uuid,
  p_account_id      uuid,
  p_payment_date    date,
  p_principal_cents bigint,
  p_charges_cents   bigint,
  p_advance_due     boolean,
  p_notes           text,
  p_idempotency_key uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid       uuid := app_private.require_user();
  v_prev      jsonb;
  v_debt      public.debts;
  v_bal       public.debt_balances;
  v_principal bigint := coalesce(p_principal_cents, 0);
  v_charges   bigint := coalesce(p_charges_cents, 0);
  v_tx_id     uuid;
  v_pay_id    uuid;
  v_result    jsonb;
begin
  v_prev := app_private.idem_begin(p_idempotency_key, 'pay_debt');
  if v_prev is not null then
    return v_prev;
  end if;

  -- Bloqueia a dívida: pagamentos simultâneos são processados um de cada vez.
  select * into v_debt from public.debts d where d.id = p_debt_id for update;
  if not found then
    perform app_private.raise_business('Dívida não encontrada.');
  end if;
  if v_debt.debt_status <> 'active' then
    perform app_private.raise_business('Esta dívida não está ativa.');
  end if;
  if p_account_id is null then
    perform app_private.raise_business('Informe a conta utilizada.');
  end if;
  if p_payment_date is null then
    perform app_private.raise_business('Informe a data do pagamento.');
  end if;
  if v_principal < 0 or v_charges < 0 or v_principal + v_charges <= 0 then
    perform app_private.raise_business('Informe um valor de pagamento maior que zero.');
  end if;

  select * into v_bal from public.debt_balances b where b.debt_id = v_debt.id;
  if v_principal > v_bal.principal_outstanding_cents then
    perform app_private.raise_business(
      format('O valor aplicado ao principal excede o principal em aberto (%s).',
             to_char(v_bal.principal_outstanding_cents / 100.0, 'FM999G999G999G990D00')),
      'Informe a diferença como juros/encargos.');
  end if;

  -- Saída bancária efetiva (validações de conta e data no trigger de lançamentos).
  insert into public.transactions (user_id, account_id, category_id, description, transaction_type, direction,
                                   amount_cents, settled_amount_cents, status, competence_date, due_date,
                                   settled_at, notes)
  values (v_uid, p_account_id, v_debt.category_id, left('Pagamento: ' || v_debt.creditor_name, 140), 'expense', 'out',
          v_principal + v_charges, v_principal + v_charges, 'paid', p_payment_date, v_debt.next_due_date,
          p_payment_date, nullif(btrim(p_notes), ''))
  returning id into v_tx_id;

  perform app_private.begin_trusted('debt_payment');
  insert into public.debt_payments (user_id, debt_id, transaction_id, amount_cents, principal_cents, charges_cents,
                                    payment_date, notes)
  values (v_uid, v_debt.id, v_tx_id, v_principal + v_charges, v_principal, v_charges, p_payment_date,
          nullif(btrim(p_notes), ''))
  returning id into v_pay_id;

  select * into v_bal from public.debt_balances b where b.debt_id = v_debt.id;
  update public.debts d
     set debt_status = case when v_bal.outstanding_cents = 0 then 'paid_off' else d.debt_status end,
         next_due_date = case
           when v_bal.outstanding_cents > 0 and coalesce(p_advance_due, false) and d.next_due_date is not null
             then (d.next_due_date + interval '1 month')::date
           else d.next_due_date end
   where d.id = v_debt.id;
  perform app_private.end_trusted();

  v_result := jsonb_build_object(
    'payment_id', v_pay_id,
    'transaction_id', v_tx_id,
    'outstanding_cents', v_bal.outstanding_cents,
    'paid_off', v_bal.outstanding_cents = 0);
  perform app_private.idem_finish(p_idempotency_key, v_result);
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: registrar encargo (juros, multa, tarifa) ou desconto
-- -----------------------------------------------------------------------------

create or replace function public.add_debt_charge(
  p_debt_id         uuid,
  p_kind            text,
  p_amount_cents    bigint,
  p_charge_date     date,
  p_description     text,
  p_idempotency_key uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_uid  uuid := app_private.require_user();
  v_prev jsonb;
  v_debt public.debts;
  v_bal  public.debt_balances;
  v_id   uuid;
begin
  v_prev := app_private.idem_begin(p_idempotency_key, 'add_debt_charge');
  if v_prev is not null then
    return (v_prev ->> 'charge_id')::uuid;
  end if;

  select * into v_debt from public.debts d where d.id = p_debt_id for update;
  if not found then
    perform app_private.raise_business('Dívida não encontrada.');
  end if;
  if p_kind is null or p_kind not in ('interest', 'fine', 'fee', 'discount') then
    perform app_private.raise_business('Tipo de encargo inválido.');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    perform app_private.raise_business('O valor deve ser maior que zero.');
  end if;
  if p_charge_date is null then
    perform app_private.raise_business('Informe a data.');
  end if;
  if p_kind = 'discount' then
    select * into v_bal from public.debt_balances b where b.debt_id = v_debt.id;
    if p_amount_cents > v_bal.charges_outstanding_cents then
      perform app_private.raise_business(
        'O desconto não pode ser maior que os encargos em aberto.',
        'Descontos sobre o principal: ajuste o valor original enquanto não houver pagamentos.');
    end if;
  end if;

  perform app_private.begin_trusted('debt_charge');
  insert into public.debt_charges (user_id, debt_id, charge_kind, amount_cents, charge_date, description)
  values (v_uid, v_debt.id, p_kind, p_amount_cents, p_charge_date, nullif(btrim(p_description), ''))
  returning id into v_id;

  -- Encargo novo em dívida quitada a reabre; desconto que zera o saldo a quita.
  select * into v_bal from public.debt_balances b where b.debt_id = v_debt.id;
  update public.debts d
     set debt_status = case
           when v_bal.outstanding_cents = 0 and d.debt_status = 'active' then 'paid_off'
           when v_bal.outstanding_cents > 0 and d.debt_status = 'paid_off' then 'active'
           else d.debt_status end
   where d.id = v_debt.id;
  perform app_private.end_trusted();

  perform app_private.idem_finish(p_idempotency_key, jsonb_build_object('charge_id', v_id));
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: salvar a ordem manual (atômico)
-- -----------------------------------------------------------------------------

create or replace function public.reorder_debts(p_debt_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_uid   uuid := app_private.require_user();
  v_found integer;
begin
  if p_debt_ids is null or cardinality(p_debt_ids) = 0 then
    return;
  end if;
  if cardinality(p_debt_ids) <> (select count(distinct x) from unnest(p_debt_ids) x) then
    perform app_private.raise_business('Lista de dívidas com itens repetidos.');
  end if;
  select count(*) into v_found from public.debts d where d.id = any (p_debt_ids) and d.user_id = v_uid;
  if v_found <> cardinality(p_debt_ids) then
    perform app_private.raise_business('Dívida não encontrada.');
  end if;

  perform app_private.begin_trusted('reorder');
  update public.debts d
     set priority_rank = o.ord
    from unnest(p_debt_ids) with ordinality as o(id, ord)
   where d.id = o.id and d.priority_rank is distinct from o.ord;
  perform app_private.end_trusted();
end;
$$;

-- -----------------------------------------------------------------------------
-- Estorno: pagamentos de dívida não são "reabertos" como despesa avulsa
-- (a dívida volta a cobrar o valor), evitando contar a obrigação duas vezes.
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
  v_is_debt  boolean;
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
  select exists (select 1 from public.debt_payments p where p.transaction_id = v_tx.id) into v_is_debt;

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

  if coalesce(p_reopen, false) and not v_is_debt and v_tx.transaction_type in ('income', 'expense') then
    insert into public.transactions (user_id, account_id, category_id, description, transaction_type, direction,
                                     amount_cents, status, competence_date, due_date, payment_method, tags, notes)
    values (v_uid, v_tx.account_id, v_tx.category_id, v_tx.description, v_tx.transaction_type, v_tx.direction,
            v_tx.amount_cents, 'pending', v_tx.competence_date, coalesce(v_tx.due_date, v_tx.settled_at),
            v_tx.payment_method, v_tx.tags, v_tx.notes)
    returning id into v_reopened;
  end if;
  perform app_private.end_trusted();

  v_prev := jsonb_build_object('reversal_ids', to_jsonb(v_rev_ids), 'reopened_id', v_reopened,
                               'debt_payment_reversed', v_is_debt);
  perform app_private.idem_finish(p_idempotency_key, v_prev);
  return v_prev;
end;
$$;

-- -----------------------------------------------------------------------------
-- Resumo financeiro: passa a considerar parcelas de dívidas a vencer.
-- Uma dívida contribui com o valor devido no próximo vencimento (parcela,
-- mínimo ou saldo), se o vencimento cair até o fim do período (inclui vencidas).
-- -----------------------------------------------------------------------------

drop function if exists public.financial_summary(date, date, uuid[], boolean, boolean, boolean);

create or replace function public.financial_summary(
  p_start                      date,
  p_end                        date,
  p_account_ids                uuid[]  default null,
  p_include_forecast_expenses  boolean default true,
  p_include_pending_income     boolean default false,
  p_include_forecast_income    boolean default false,
  p_include_debts              boolean default true)
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
  debt_due as (
    select app_private.debt_amount_due(d, b.outstanding_cents) as amount_cents, d.next_due_date
      from public.debts d
      join public.debt_balances b on b.debt_id = d.id
     where d.debt_status = 'active'
       and b.outstanding_cents > 0
       and d.next_due_date is not null
       and d.next_due_date <= p_end
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
  dd as (
    select
      case when p_include_debts then coalesce(sum(amount_cents), 0) else 0 end as due,
      coalesce(sum(amount_cents) filter (where next_due_date < v_today), 0) as overdue,
      count(*) filter (where next_due_date < v_today) as overdue_count,
      count(*) as due_count
    from debt_due
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
    'committed_cents', o.exp_pending_upto + case when p_include_forecast_expenses then o.exp_forecast_upto else 0 end + dd.due,
    'considered_income_cents',
        case when p_include_pending_income then o.inc_pending_upto else 0 end
      + case when p_include_forecast_income then o.inc_forecast_upto else 0 end,
    'free_cents', b.bank
      - (o.exp_pending_upto + case when p_include_forecast_expenses then o.exp_forecast_upto else 0 end + dd.due)
      + case when p_include_pending_income then o.inc_pending_upto else 0 end
      + case when p_include_forecast_income then o.inc_forecast_upto else 0 end,
    'projected_end_cents', b.bank + o.inc_pending_upto + o.inc_forecast_upto - o.exp_pending_upto - o.exp_forecast_upto - dd.due,
    'projection_uncertain_income_cents', o.inc_forecast_upto,
    'debts', jsonb_build_object(
      'due_cents', dd.due,
      'due_count', dd.due_count,
      'overdue_cents', dd.overdue,
      'overdue_count', dd.overdue_count),
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
  from o, s, b, dd;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Projeção diária do saldo bancário
-- Saldo do dia = saldo atual + entradas em aberto até o dia − saídas em aberto
-- até o dia − parcelas de dívidas até o dia. Itens vencidos entram hoje.
-- -----------------------------------------------------------------------------

create or replace function public.balance_projection(
  p_end                       date,
  p_include_forecast_expenses boolean default true,
  p_include_pending_income    boolean default true,
  p_include_forecast_income   boolean default false,
  p_include_debts             boolean default true)
returns table (day date, inflow_cents bigint, outflow_cents bigint, balance_cents bigint, uncertain_cents bigint)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := app_private.user_today();
  v_bank  bigint;
begin
  perform app_private.require_user();
  if p_end is null or p_end < v_today then
    perform app_private.raise_business('A projeção precisa terminar hoje ou depois.');
  end if;
  if p_end - v_today > 400 then
    perform app_private.raise_business('Projeção limitada a 400 dias.');
  end if;

  select coalesce(sum(b.balance_cents), 0) into v_bank
    from public.account_balances b
   where b.is_active and b.account_type <> 'benefit';

  return query
  with movements as (
    select greatest(coalesce(t.due_date, t.competence_date), v_today) as d,
           case when t.direction = 'in' then t.amount_cents else 0 end as inflow,
           case when t.direction = 'out' then t.amount_cents else 0 end as outflow,
           case when t.direction = 'in' and t.status = 'forecast' then t.amount_cents else 0 end as uncertain
      from public.transactions t
      left join public.accounts a on a.id = t.account_id
     where t.transaction_type in ('income', 'expense')
       and (a.id is null or a.account_type <> 'benefit')
       and coalesce(t.due_date, t.competence_date) <= p_end
       and (
         (t.direction = 'out' and (t.status = 'pending' or (t.status = 'forecast' and p_include_forecast_expenses)))
         or (t.direction = 'in' and ((t.status = 'pending' and p_include_pending_income)
                                     or (t.status = 'forecast' and p_include_forecast_income))))
    union all
    select greatest(d.next_due_date, v_today), 0, app_private.debt_amount_due(d, b.outstanding_cents), 0
      from public.debts d
      join public.debt_balances b on b.debt_id = d.id
     where p_include_debts
       and d.debt_status = 'active'
       and b.outstanding_cents > 0
       and d.next_due_date is not null
       and d.next_due_date <= p_end
  ),
  days as (
    select g::date as d from generate_series(v_today, p_end, interval '1 day') g
  ),
  per_day as (
    select days.d,
           coalesce(sum(m.inflow), 0)::bigint as inflow,
           coalesce(sum(m.outflow), 0)::bigint as outflow,
           coalesce(sum(m.uncertain), 0)::bigint as uncertain
      from days
      left join movements m on m.d = days.d
     group by days.d
  )
  select per_day.d,
         per_day.inflow,
         per_day.outflow,
         (v_bank + sum(per_day.inflow - per_day.outflow) over (order by per_day.d))::bigint,
         (sum(per_day.uncertain) over (order by per_day.d))::bigint
    from per_day
   order by per_day.d;
end;
$$;

-- -----------------------------------------------------------------------------
-- Perfil financeiro (contexto para o assistente) e consentimento de IA
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column occupation           text check (occupation is null or char_length(occupation) <= 120),
  add column income_type          text check (income_type is null or income_type in ('fixed', 'variable', 'mixed')),
  add column monthly_income_cents bigint check (monthly_income_cents is null or monthly_income_cents >= 0),
  add column paydays              smallint[] not null default '{}'
    check (cardinality(paydays) <= 4 and paydays <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]::smallint[]),
  add column financial_context    text check (financial_context is null or char_length(financial_context) <= 2000),
  add column ai_consent_at        timestamptz;

comment on column public.profiles.financial_context is
  'Texto livre do usuário sobre a própria situação (ex.: usa o limite do cartão para obter dinheiro). Enviado ao assistente de IA somente com consentimento.';

-- Histórico das análises do assistente (também usado como limite diário).
create table public.advisor_reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  model         text not null,
  question      text check (question is null or char_length(question) <= 1000),
  available_cents bigint,
  advice        jsonb not null,
  input_tokens  integer,
  output_tokens integer,
  created_at    timestamptz not null default now()
);

create index advisor_reports_user_idx on public.advisor_reports (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- RLS e privilégios
-- -----------------------------------------------------------------------------

alter table public.advisor_reports enable row level security;
alter table public.debts         enable row level security;
alter table public.debt_charges  enable row level security;
alter table public.debt_payments enable row level security;

create policy debts_select on public.debts for select to authenticated using (user_id = (select auth.uid()));
create policy debts_insert on public.debts for insert to authenticated with check (user_id = (select auth.uid()));
create policy debts_update on public.debts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy debts_delete on public.debts for delete to authenticated using (user_id = (select auth.uid()));

create policy advisor_reports_select on public.advisor_reports for select to authenticated using (user_id = (select auth.uid()));
create policy advisor_reports_insert on public.advisor_reports for insert to authenticated with check (user_id = (select auth.uid()));

create policy debt_charges_select on public.debt_charges for select to authenticated using (user_id = (select auth.uid()));
create policy debt_charges_insert on public.debt_charges for insert to authenticated with check (user_id = (select auth.uid()));

create policy debt_payments_select on public.debt_payments for select to authenticated using (user_id = (select auth.uid()));
create policy debt_payments_insert on public.debt_payments for insert to authenticated with check (user_id = (select auth.uid()));
create policy debt_payments_update on public.debt_payments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.debts, public.debt_charges, public.debt_payments, public.debt_balances, public.advisor_reports from anon;
revoke all on all functions in schema public from anon, public;
revoke all on all functions in schema app_private from anon, public;

grant select, insert, update, delete on public.debts to authenticated;
grant select, insert on public.debt_charges to authenticated;
grant select, insert, update on public.debt_payments to authenticated;
grant select on public.debt_balances to authenticated;
grant select, insert on public.advisor_reports to authenticated;

grant execute on function
  app_private.debt_amount_due(public.debts, bigint),
  app_private.tg_debts_guard(), app_private.tg_debt_history_guard(), app_private.tg_transactions_debt_reversal()
  to authenticated;

grant execute on function
  public.pay_debt(uuid, uuid, date, bigint, bigint, boolean, text, uuid),
  public.add_debt_charge(uuid, text, bigint, date, text, uuid),
  public.reorder_debts(uuid[]),
  public.reverse_transaction(uuid, text, boolean, uuid),
  public.financial_summary(date, date, uuid[], boolean, boolean, boolean, boolean),
  public.balance_projection(date, boolean, boolean, boolean, boolean)
  to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.debts, public.debt_payments, public.debt_charges;
  end if;
end;
$$;
