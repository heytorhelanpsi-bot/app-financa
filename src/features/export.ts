import { supabase } from '@/lib/supabase';
import { centsToInput } from '@/lib/money';
import { PAYMENT_METHOD_LABEL, STATUS_LABEL, TYPE_LABEL } from '@/lib/labels';
import type { Account, Category, Transaction } from '@/lib/types';

/** Escapa uma célula CSV e neutraliza fórmulas (injeção em planilhas). */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // BOM + ";" para abrir corretamente no Excel em português.
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
}

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function transactionsToCsv(rows: Transaction[], accounts: Account[], categories: Category[]): string {
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  return toCsv(
    [
      'id', 'tipo', 'descricao', 'situacao', 'valor_previsto', 'valor_efetivo', 'sinal', 'competencia', 'vencimento',
      'data_efetiva', 'conta', 'categoria', 'forma_pagamento', 'etiquetas', 'observacoes', 'estornado', 'arquivado',
    ],
    rows.map((t) => [
      t.id,
      TYPE_LABEL[t.transaction_type],
      t.description,
      STATUS_LABEL[t.status],
      centsToInput(t.amount_cents),
      t.settled_amount_cents === null ? '' : centsToInput(t.settled_amount_cents),
      t.direction === 'in' ? 'entrada' : 'saída',
      t.competence_date,
      t.due_date ?? '',
      t.settled_at ?? '',
      t.account_id ? acc.get(t.account_id) ?? '' : '',
      t.category_id ? cat.get(t.category_id) ?? '' : '',
      t.payment_method ? PAYMENT_METHOD_LABEL[t.payment_method] : '',
      t.tags.join(', '),
      t.notes ?? '',
      t.reversed_at ? 'sim' : 'não',
      t.archived_at ? 'sim' : 'não',
    ]),
  );
}

export function exportTransactionsCsv(rows: Transaction[], accounts: Account[], categories: Category[], name: string) {
  download(`${name}.csv`, transactionsToCsv(rows, accounts, categories), 'text/csv;charset=utf-8');
}

async function fetchAll(table: string, order = 'created_at') {
  const pageSize = 1000;
  const out: unknown[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select('*').order(order).range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/** Exporta todos os dados do próprio usuário (RLS garante o isolamento). */
export async function exportAllData() {
  const [profile, accounts, categories, transactions, auditLogs] = await Promise.all([
    fetchAll('profiles', 'id'),
    fetchAll('accounts'),
    fetchAll('categories'),
    fetchAll('transactions'),
    fetchAll('audit_logs'),
  ]);
  const payload = {
    format: 'financeiro-pessoal-inteligente/v1',
    exported_at: new Date().toISOString(),
    note: 'Valores em centavos (inteiros).',
    profile: profile[0] ?? null,
    accounts,
    categories,
    transactions,
    audit_logs: auditLogs,
  };
  download(
    `financeiro-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2),
    'application/json',
  );
}
