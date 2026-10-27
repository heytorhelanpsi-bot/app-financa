export type Cents = number;

export type AccountType = 'checking' | 'savings' | 'cash' | 'investment' | 'benefit' | 'other';
export type CategoryType = 'income' | 'expense' | 'both';
export type TransactionType = 'income' | 'expense' | 'transfer' | 'adjustment' | 'reversal';
export type Direction = 'in' | 'out';
export type TransactionStatus = 'forecast' | 'pending' | 'paid' | 'received' | 'canceled';
export type PaymentMethod =
  | 'pix'
  | 'debit'
  | 'credit'
  | 'cash'
  | 'boleto'
  | 'transfer'
  | 'auto_debit'
  | 'benefit_card'
  | 'other';
export type Theme = 'dark' | 'light' | 'system';

export interface Profile {
  id: string;
  display_name: string | null;
  currency_code: string;
  timezone: string;
  theme: Theme;
  occupation: string | null;
  income_type: 'fixed' | 'variable' | 'mixed' | null;
  monthly_income_cents: number | null;
  paydays: number[];
  financial_context: string | null;
  ai_consent_at: string | null;
  version: number;
}

export interface Account {
  id: string;
  user_id: string;
  name: string;
  institution_name: string | null;
  account_type: AccountType;
  currency_code: string;
  opening_balance_cents: number;
  opening_date: string;
  color: string | null;
  sort_order: number;
  is_active: boolean;
  version: number;
  created_at: string;
}

export interface AccountBalance {
  account_id: string;
  name: string;
  institution_name: string | null;
  account_type: AccountType;
  currency_code: string;
  is_active: boolean;
  opening_balance_cents: number;
  opening_date: string;
  balance_cents: number;
  last_movement_at: string | null;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  category_type: CategoryType;
  parent_id: string | null;
  color: string | null;
  is_essential: boolean;
  sort_order: number;
  is_active: boolean;
  version: number;
}

export interface Transaction {
  id: string;
  user_id: string;
  account_id: string | null;
  category_id: string | null;
  description: string;
  transaction_type: TransactionType;
  direction: Direction;
  amount_cents: number;
  settled_amount_cents: number | null;
  status: TransactionStatus;
  competence_date: string;
  due_date: string | null;
  settled_at: string | null;
  ref_date: string;
  payment_method: PaymentMethod | null;
  tags: string[];
  notes: string | null;
  transfer_group_id: string | null;
  reversal_of_id: string | null;
  reversed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface FinancialSummary {
  today: string;
  period_start: string;
  period_end: string;
  bank_balance_cents: number;
  benefit_balance_cents: number;
  committed_cents: number;
  considered_income_cents: number;
  free_cents: number;
  projected_end_cents: number;
  projection_uncertain_income_cents: number;
  debts: {
    due_cents: number;
    due_count: number;
    overdue_cents: number;
    overdue_count: number;
  };
  expenses: {
    paid_cents: number;
    pending_cents: number;
    forecast_cents: number;
    overdue_cents: number;
    overdue_count: number;
  };
  income: {
    received_cents: number;
    pending_cents: number;
    forecast_cents: number;
    late_cents: number;
    late_count: number;
  };
}

export interface AuditLog {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  context: string | null;
  created_at: string;
}

// ---------------------------------------------------------------- Fase 2

export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low';
export type LateConsequence =
  | 'service_cut'
  | 'asset_loss'
  | 'personal_trust'
  | 'legal_action'
  | 'credit_restriction'
  | 'high_interest'
  | 'other'
  | 'none';
export type DebtStatus = 'active' | 'paid_off' | 'archived';
export type ChargeKind = 'interest' | 'fine' | 'fee' | 'discount';

export interface Debt {
  id: string;
  user_id: string;
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
  priority_level: PriorityLevel;
  priority_rank: number;
  is_essential: boolean;
  late_consequence: LateConsequence;
  consequence_notes: string | null;
  debt_status: DebtStatus;
  notes: string | null;
  version: number;
  created_at: string;
}

export interface DebtBalance {
  debt_id: string;
  original_amount_cents: number;
  principal_paid_cents: number;
  charges_paid_cents: number;
  total_paid_cents: number;
  charges_added_cents: number;
  discounts_cents: number;
  principal_outstanding_cents: number;
  charges_outstanding_cents: number;
  outstanding_cents: number;
  last_payment_at: string | null;
  payments_count: number;
}

export interface DebtPayment {
  id: string;
  debt_id: string;
  transaction_id: string;
  amount_cents: number;
  principal_cents: number;
  charges_cents: number;
  payment_date: string;
  notes: string | null;
  reversed_at: string | null;
  created_at: string;
}

export interface DebtCharge {
  id: string;
  debt_id: string;
  charge_kind: ChargeKind;
  amount_cents: number;
  charge_date: string;
  description: string | null;
  created_at: string;
}

export interface ProjectionPoint {
  day: string;
  inflow_cents: number;
  outflow_cents: number;
  balance_cents: number;
  uncertain_cents: number;
}
