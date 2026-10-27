import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { ConflictError } from '@/lib/errors';
import type {
  Debt,
  DebtBalance,
  DebtCharge,
  DebtPayment,
  ProjectionPoint,
  Account,
  AccountBalance,
  AuditLog,
  Category,
  FinancialSummary,
  Profile,
  Transaction,
  TransactionStatus,
} from '@/lib/types';

// -----------------------------------------------------------------------------
// Chaves de cache
// -----------------------------------------------------------------------------

export const keys = {
  profile: ['profile'] as const,
  accounts: ['accounts'] as const,
  balances: ['balances'] as const,
  categories: ['categories'] as const,
  transactions: ['transactions'] as const,
  summary: ['summary'] as const,
  audit: ['audit'] as const,
  debts: ['debts'] as const,
  projection: ['projection'] as const,
};

/** Após qualquer alteração financeira confirmada, saldos e relatórios são recarregados. */
export function invalidateFinancial(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: keys.transactions }),
    qc.invalidateQueries({ queryKey: keys.balances }),
    qc.invalidateQueries({ queryKey: keys.summary }),
    qc.invalidateQueries({ queryKey: keys.accounts }),
    qc.invalidateQueries({ queryKey: keys.audit }),
    qc.invalidateQueries({ queryKey: keys.debts }),
    qc.invalidateQueries({ queryKey: keys.projection }),
  ]);
}

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error;
  return data as T;
}

/** Atualização com controle otimista de versão: falha se outro dispositivo alterou antes. */
async function updateVersioned<T>(table: string, id: string, version: number, patch: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).eq('version', version).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new ConflictError();
  return data[0] as T;
}

// -----------------------------------------------------------------------------
// Perfil
// -----------------------------------------------------------------------------

export function useProfile() {
  return useQuery({
    queryKey: keys.profile,
    queryFn: async () => unwrap<Profile>(await supabase.from('profiles').select('*').single()),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: {
      profile: Profile;
      patch: Partial<
        Pick<
          Profile,
          | 'display_name'
          | 'theme'
          | 'timezone'
          | 'occupation'
          | 'income_type'
          | 'monthly_income_cents'
          | 'paydays'
          | 'financial_context'
          | 'ai_consent_at'
        >
      >;
    }) =>
      updateVersioned<Profile>('profiles', p.profile.id, p.profile.version, p.patch),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.profile }),
  });
}

// -----------------------------------------------------------------------------
// Contas
// -----------------------------------------------------------------------------

export function useAccounts() {
  return useQuery({
    queryKey: keys.accounts,
    queryFn: async () =>
      unwrap<Account[]>(
        await supabase.from('accounts').select('*').order('sort_order').order('created_at'),
      ),
  });
}

export function useBalances() {
  return useQuery({
    queryKey: keys.balances,
    queryFn: async () => unwrap<AccountBalance[]>(await supabase.from('account_balances').select('*')),
  });
}

export interface AccountInput {
  name: string;
  institution_name: string | null;
  account_type: Account['account_type'];
  opening_balance_cents: number;
  opening_date: string;
  color: string | null;
  is_active: boolean;
}

export function useSaveAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; existing?: Account; input: AccountInput }) => {
      if (p.existing) {
        const patch: Partial<AccountInput> = { ...p.input };
        // Evita enviar campos protegidos sem alteração (o banco recusa mudanças após lançamentos).
        if (patch.opening_balance_cents === p.existing.opening_balance_cents) delete patch.opening_balance_cents;
        if (patch.opening_date === p.existing.opening_date) delete patch.opening_date;
        return updateVersioned<Account>('accounts', p.id, p.existing.version, patch);
      }
      const { error } = await supabase
        .from('accounts')
        .upsert({ id: p.id, ...p.input }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
    },
    onSettled: () => invalidateFinancial(qc),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('accounts').delete().eq('id', id)),
    onSettled: () => invalidateFinancial(qc),
  });
}

export function useTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      from: string;
      to: string;
      amount_cents: number;
      date: string;
      description: string;
      key: string;
    }) =>
      unwrap<string>(
        await supabase.rpc('create_transfer', {
          p_from_account_id: p.from,
          p_to_account_id: p.to,
          p_amount_cents: p.amount_cents,
          p_date: p.date,
          p_description: p.description,
          p_idempotency_key: p.key,
        }),
      ),
    onSettled: () => invalidateFinancial(qc),
  });
}

export function useAdjustBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { account_id: string; target_cents: number; date: string; reason: string; key: string }) =>
      unwrap<string>(
        await supabase.rpc('adjust_account_balance', {
          p_account_id: p.account_id,
          p_target_balance_cents: p.target_cents,
          p_date: p.date,
          p_reason: p.reason,
          p_idempotency_key: p.key,
        }),
      ),
    onSettled: () => invalidateFinancial(qc),
  });
}

// -----------------------------------------------------------------------------
// Categorias
// -----------------------------------------------------------------------------

export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: async () =>
      unwrap<Category[]>(await supabase.from('categories').select('*').order('sort_order').order('name')),
  });
}

export interface CategoryInput {
  name: string;
  category_type: Category['category_type'];
  parent_id: string | null;
  color: string | null;
  is_essential: boolean;
  is_active: boolean;
  sort_order?: number;
}

export function useSaveCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; existing?: Category; input: Partial<CategoryInput> }) => {
      if (p.existing) return updateVersioned<Category>('categories', p.id, p.existing.version, p.input);
      const { error } = await supabase
        .from('categories')
        .upsert({ id: p.id, ...p.input }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.categories }),
  });
}

/** Troca a posição de duas categorias (controles acessíveis de subir/descer). */
export function useSwapCategoryOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { a: Category; b: Category }) => {
      const aOrder = p.a.sort_order === p.b.sort_order ? p.b.sort_order + 1 : p.b.sort_order;
      await updateVersioned('categories', p.a.id, p.a.version, { sort_order: aOrder });
      await updateVersioned('categories', p.b.id, p.b.version, { sort_order: p.a.sort_order });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.categories }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('categories').delete().eq('id', id)),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.categories }),
  });
}

// -----------------------------------------------------------------------------
// Lançamentos
// -----------------------------------------------------------------------------

export type TypeFilter = 'all' | 'income' | 'expense' | 'transfer' | 'other';
export type StatusFilter = 'all' | 'open' | 'overdue' | 'settled' | 'forecast' | 'pending' | 'canceled';

export interface TransactionFilters {
  start: string;
  end: string;
  today: string;
  type: TypeFilter;
  status: StatusFilter;
  accountId: string | null;
  categoryIds: string[] | null;
  search: string;
  showArchived: boolean;
}

export const TX_LIMIT = 1000;

export function useTransactions(f: TransactionFilters) {
  return useQuery({
    queryKey: [...keys.transactions, f],
    queryFn: async () => {
      let q = supabase.from('transactions').select('*');
      if (f.status === 'overdue') {
        q = q.in('status', ['forecast', 'pending']).lt('ref_date', f.today);
      } else {
        q = q.gte('ref_date', f.start).lte('ref_date', f.end);
        if (f.status === 'open') q = q.in('status', ['forecast', 'pending']);
        if (f.status === 'settled') q = q.in('status', ['paid', 'received']);
        if (f.status === 'forecast' || f.status === 'pending' || f.status === 'canceled') q = q.eq('status', f.status);
      }
      if (f.type === 'income' || f.type === 'expense' || f.type === 'transfer') q = q.eq('transaction_type', f.type);
      if (f.type === 'other') q = q.in('transaction_type', ['adjustment', 'reversal']);
      if (f.accountId) q = q.eq('account_id', f.accountId);
      if (f.categoryIds?.length) q = q.in('category_id', f.categoryIds);
      if (!f.showArchived) q = q.is('archived_at', null);
      const s = f.search.trim();
      if (s) q = q.ilike('description', `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      q = q.order('ref_date', { ascending: false }).order('created_at', { ascending: false }).limit(TX_LIMIT);
      return unwrap<Transaction[]>(await q);
    },
  });
}

/** Lançamentos em aberto (pendentes/previstos) até uma data, para a tela inicial. */
export function useOpenTransactions(until: string) {
  return useQuery({
    queryKey: [...keys.transactions, 'open', until],
    queryFn: async () =>
      unwrap<Transaction[]>(
        await supabase
          .from('transactions')
          .select('*')
          .in('status', ['forecast', 'pending'])
          .lte('ref_date', until)
          .order('ref_date')
          .limit(200),
      ),
  });
}

export interface TransactionInput {
  description: string;
  transaction_type: 'income' | 'expense';
  amount_cents: number;
  category_id: string | null;
  account_id: string | null;
  competence_date: string;
  due_date: string | null;
  status: TransactionStatus;
  settled_at: string | null;
  settled_amount_cents: number | null;
  payment_method: Transaction['payment_method'];
  tags: string[];
  notes: string | null;
}

export function useSaveTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; existing?: Transaction; input: TransactionInput }) => {
      const direction = p.input.transaction_type === 'income' ? 'in' : 'out';
      if (p.existing) {
        const patch: Record<string, unknown> = { ...p.input, direction };
        const wasSettled = p.existing.status === 'paid' || p.existing.status === 'received';
        if (wasSettled) {
          // Em lançamentos efetivados apenas campos descritivos podem mudar.
          for (const k of ['transaction_type', 'direction', 'amount_cents', 'status', 'account_id', 'settled_at', 'settled_amount_cents']) {
            delete patch[k];
          }
        } else {
          delete patch.settled_at;
          delete patch.settled_amount_cents;
        }
        return updateVersioned<Transaction>('transactions', p.id, p.existing.version, patch);
      }
      // Inserção idempotente: o id é gerado no dispositivo; um reenvio não duplica.
      const { error } = await supabase
        .from('transactions')
        .upsert({ id: p.id, ...p.input, direction }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
    },
    onSettled: () => invalidateFinancial(qc),
  });
}

export function useSettleTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; account_id: string; settled_at: string; amount_cents: number; key: string }) =>
      unwrap<Transaction>(
        await supabase
          .rpc('settle_transaction', {
            p_transaction_id: p.id,
            p_account_id: p.account_id,
            p_settled_at: p.settled_at,
            p_amount_cents: p.amount_cents,
            p_idempotency_key: p.key,
          })
          .single(),
      ),
    onSettled: () => invalidateFinancial(qc),
  });
}

export function useReverseTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; reason: string; reopen: boolean; key: string }) =>
      unwrap<{ reversal_ids: string[]; reopened_id: string | null }>(
        await supabase.rpc('reverse_transaction', {
          p_transaction_id: p.id,
          p_reason: p.reason,
          p_reopen: p.reopen,
          p_idempotency_key: p.key,
        }),
      ),
    onSettled: () => invalidateFinancial(qc),
  });
}

export function useUpdateTransactionFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { tx: Transaction; patch: Partial<Pick<Transaction, 'status' | 'archived_at'>> }) =>
      updateVersioned<Transaction>('transactions', p.tx.id, p.tx.version, p.patch),
    onSettled: () => invalidateFinancial(qc),
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('transactions').delete().eq('id', id)),
    onSettled: () => invalidateFinancial(qc),
  });
}

export function useAuditTrail(entityId: string | null) {
  return useQuery({
    queryKey: [...keys.audit, entityId],
    enabled: !!entityId,
    queryFn: async () =>
      unwrap<AuditLog[]>(
        await supabase
          .from('audit_logs')
          .select('id, entity_type, entity_id, action, context, created_at')
          .eq('entity_id', entityId!)
          .order('created_at'),
      ),
  });
}

// -----------------------------------------------------------------------------
// Resumo
// -----------------------------------------------------------------------------

export interface SummaryParams {
  start: string;
  end: string;
  includeForecastExpenses: boolean;
  includePendingIncome: boolean;
  includeForecastIncome: boolean;
}

export function useSummary(p: SummaryParams) {
  return useQuery({
    queryKey: [...keys.summary, p],
    queryFn: async () =>
      unwrap<FinancialSummary>(
        await supabase.rpc('financial_summary', {
          p_start: p.start,
          p_end: p.end,
          p_account_ids: null,
          p_include_forecast_expenses: p.includeForecastExpenses,
          p_include_pending_income: p.includePendingIncome,
          p_include_forecast_income: p.includeForecastIncome,
          p_include_debts: true,
        }),
      ),
  });
}

// -----------------------------------------------------------------------------
// Projeção diária
// -----------------------------------------------------------------------------

export function useProjection(p: {
  end: string;
  includeForecastExpenses: boolean;
  includePendingIncome: boolean;
  includeForecastIncome: boolean;
}) {
  return useQuery({
    queryKey: [...keys.projection, p],
    queryFn: async () =>
      unwrap<ProjectionPoint[]>(
        await supabase.rpc('balance_projection', {
          p_end: p.end,
          p_include_forecast_expenses: p.includeForecastExpenses,
          p_include_pending_income: p.includePendingIncome,
          p_include_forecast_income: p.includeForecastIncome,
          p_include_debts: true,
        }),
      ),
  });
}

// -----------------------------------------------------------------------------
// Dívidas
// -----------------------------------------------------------------------------

export function useDebts() {
  return useQuery({
    queryKey: keys.debts,
    queryFn: async () => {
      const [debts, balances] = await Promise.all([
        supabase.from('debts').select('*').order('priority_rank').order('created_at'),
        supabase.from('debt_balances').select('*'),
      ]);
      return { debts: unwrap<Debt[]>(debts), balances: unwrap<DebtBalance[]>(balances) };
    },
  });
}

export function useDebtHistory(debtId: string | null) {
  return useQuery({
    queryKey: [...keys.debts, 'history', debtId],
    enabled: !!debtId,
    queryFn: async () => {
      const [payments, charges] = await Promise.all([
        supabase.from('debt_payments').select('*').eq('debt_id', debtId!).order('payment_date', { ascending: false }),
        supabase.from('debt_charges').select('*').eq('debt_id', debtId!).order('charge_date', { ascending: false }),
      ]);
      return { payments: unwrap<DebtPayment[]>(payments), charges: unwrap<DebtCharge[]>(charges) };
    },
  });
}

export interface DebtInput {
  creditor_name: string;
  description: string | null;
  original_amount_cents: number;
  contracted_amount_cents: number | null;
  minimum_payment_cents: number | null;
  installment_amount_cents: number | null;
  installments_total: number | null;
  next_due_date: string | null;
  interest_rate_monthly: number | null;
  late_fee_percent: number | null;
  category_id: string | null;
  account_id: string | null;
  priority_level: Debt['priority_level'];
  is_essential: boolean;
  late_consequence: Debt['late_consequence'];
  consequence_notes: string | null;
  notes: string | null;
}

export function useSaveDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; existing?: Debt; input: Partial<DebtInput> & { debt_status?: Debt['debt_status'] } }) => {
      if (p.existing) {
        const patch: Record<string, unknown> = { ...p.input };
        if (patch.original_amount_cents === p.existing.original_amount_cents) delete patch.original_amount_cents;
        return updateVersioned<Debt>('debts', p.id, p.existing.version, patch);
      }
      const { error } = await supabase.from('debts').upsert({ id: p.id, ...p.input }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
    },
    onSettled: () => invalidateFinancial(qc),
  });
}

export function useDeleteDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('debts').delete().eq('id', id)),
    onSettled: () => invalidateFinancial(qc),
  });
}

export function usePayDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      debt_id: string;
      account_id: string;
      date: string;
      principal_cents: number;
      charges_cents: number;
      advance_due: boolean;
      notes: string;
      key: string;
    }) =>
      unwrap<{ payment_id: string; transaction_id: string; outstanding_cents: number; paid_off: boolean }>(
        await supabase.rpc('pay_debt', {
          p_debt_id: p.debt_id,
          p_account_id: p.account_id,
          p_payment_date: p.date,
          p_principal_cents: p.principal_cents,
          p_charges_cents: p.charges_cents,
          p_advance_due: p.advance_due,
          p_notes: p.notes,
          p_idempotency_key: p.key,
        }),
      ),
    onSettled: () => invalidateFinancial(qc),
  });
}

export function useAddDebtCharge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { debt_id: string; kind: DebtCharge['charge_kind']; amount_cents: number; date: string; description: string; key: string }) =>
      unwrap<string>(
        await supabase.rpc('add_debt_charge', {
          p_debt_id: p.debt_id,
          p_kind: p.kind,
          p_amount_cents: p.amount_cents,
          p_charge_date: p.date,
          p_description: p.description,
          p_idempotency_key: p.key,
        }),
      ),
    onSettled: () => invalidateFinancial(qc),
  });
}

export function useReorderDebts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => unwrap(await supabase.rpc('reorder_debts', { p_debt_ids: ids })),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.debts }),
  });
}
