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
