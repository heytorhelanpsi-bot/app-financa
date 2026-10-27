import { useEffect, useState } from 'react';
import { Field, FormError, Toggle, useToast } from '@/components/ui';
import { useUpdateProfile } from '@/hooks/data';
import { centsToInput, parseMoneyToCents } from '@/lib/money';
import { friendlyError } from '@/lib/errors';
import type { Profile } from '@/lib/types';

const INCOME_TYPES = [
  ['fixed', 'Fixa (salário)'],
  ['variable', 'Variável'],
  ['mixed', 'Mista'],
] as const;

/** Contexto pessoal que orienta o assistente de IA, com consentimento explícito. */
export function FinancialProfileForm({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const toast = useToast();
  const [f, setF] = useState(() => fromProfile(profile));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setF(fromProfile(profile)), [profile.version]); // eslint-disable-line react-hooks/exhaustive-deps

  function save(e: React.FormEvent) {
    e.preventDefault();
    const income = f.income.trim() ? parseMoneyToCents(f.income) : null;
    if (income !== null && income < 0) return setError('Renda inválida.');
    if (f.income.trim() && income === null) return setError('Renda inválida.');
    const days = f.paydays
      .split(/[,;\s]+/)
      .filter(Boolean)
      .map(Number);
    if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 31) || days.length > 4) {
      return setError('Dias de recebimento: até 4 números entre 1 e 31, separados por vírgula.');
    }
    setError(null);
    update.mutate(
      {
        profile,
        patch: {
          occupation: f.occupation.trim() || null,
          income_type: f.incomeType || null,
          monthly_income_cents: income,
          paydays: [...new Set(days)].sort((a, b) => a - b),
          financial_context: f.context.trim() || null,
          ai_consent_at: f.consent ? profile.ai_consent_at ?? new Date().toISOString() : null,
        },
      },
      { onSuccess: () => toast('Perfil financeiro salvo.') },
    );
  }

  return (
    <section id="perfil-financeiro" className="card scroll-mt-24 space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Perfil financeiro</h2>
        <p className="mt-1 text-sm text-muted">
          Conte como é a sua realidade. O assistente de IA usa estas informações para sugerir a ordem de pagamento e
          alertar sobre decisões que pioram a situação.
        </p>
      </div>
      <form onSubmit={save} noValidate className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormError message={error ?? (update.error ? friendlyError(update.error) : null)} />
        </div>
        <Field label="Ocupação" htmlFor="fp-occ">
          <input id="fp-occ" className="input" maxLength={120} value={f.occupation} onChange={(e) => setF({ ...f, occupation: e.target.value })} placeholder="Ex.: servidor público" />
        </Field>
        <Field label="Tipo de renda" htmlFor="fp-type">
          <select id="fp-type" className="input" value={f.incomeType} onChange={(e) => setF({ ...f, incomeType: e.target.value as typeof f.incomeType })}>
            <option value="">Não informar</option>
            {INCOME_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Renda mensal líquida (R$)" htmlFor="fp-income">
          <input id="fp-income" className="input tabular" inputMode="decimal" value={f.income} onChange={(e) => setF({ ...f, income: e.target.value })} placeholder="Opcional" />
        </Field>
        <Field label="Dias em que recebe" htmlFor="fp-days" hint="Ex.: 5, 20">
          <input id="fp-days" className="input" inputMode="numeric" value={f.paydays} onChange={(e) => setF({ ...f, paydays: e.target.value })} />
        </Field>
        <Field
          label="Sua situação, com suas palavras"
          htmlFor="fp-ctx"
          className="sm:col-span-2"
          hint={`${f.context.length}/2000`}
        >
          <textarea
            id="fp-ctx"
            className="input min-h-[140px]"
            maxLength={2000}
            value={f.context}
            onChange={(e) => setF({ ...f, context: e.target.value })}
            placeholder="Ex.: Sou servidor público, ganho bem, mas gasto mais do que recebo. Uso o limite do cartão como crédito passando na maquininha (pago a taxa) e recebo em dinheiro para pagar as próximas contas. Tenho dívidas com pessoas que não posso atrasar."
          />
        </Field>
        <div className="rounded-2xl border border-fg/10 p-4 sm:col-span-2">
          <Toggle
            checked={f.consent}
            onChange={(v) => setF({ ...f, consent: v })}
            label="Permitir análise por IA"
            description="A cada análise que você pedir, um resumo do seu perfil, saldos, dívidas e contas é enviado ao Claude (Anthropic) para gerar as recomendações. Senhas e dados bancários de acesso nunca são enviados. Você pode desligar a qualquer momento."
          />
        </div>
        <div className="sm:col-span-2">
          <button className="btn-primary" disabled={update.isPending}>{update.isPending ? 'Salvando…' : 'Salvar perfil'}</button>
        </div>
      </form>
    </section>
  );
}

function fromProfile(p: Profile) {
  return {
    occupation: p.occupation ?? '',
    incomeType: (p.income_type ?? '') as '' | 'fixed' | 'variable' | 'mixed',
    income: p.monthly_income_cents ? centsToInput(p.monthly_income_cents) : '',
    paydays: (p.paydays ?? []).join(', '),
    context: p.financial_context ?? '',
    consent: !!p.ai_consent_at,
  };
}
