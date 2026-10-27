import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, FormError, Money } from '@/components/ui';
import { IconAlert } from '@/components/icons';
import { useProfile } from '@/hooks/data';
import { supabase } from '@/lib/supabase';
import type { DebtView } from '@/features/debts/logic';

export interface AdvisorAdvice {
  diagnostico: string;
  ordem: { debt_id: string; motivo: string; pagamento_sugerido_centavos: number | null }[];
  plano: { titulo: string; detalhe: string; quando: string | null }[];
  recomendacoes: { titulo: string; detalhe: string; impacto: 'alto' | 'medio' | 'baixo'; tipo: string }[];
  alertas: string[];
  perguntas: string[];
}

export interface AdvisorReport {
  id: string;
  created_at: string;
  model: string;
  question: string | null;
  available_cents: number | null;
  advice: AdvisorAdvice;
}

/** Ordem recomendada consumida pela lista de dívidas. */
export interface AdvisorOrder {
  order: { debt_id: string; reason: string; suggested_cents: number | null }[];
}

const KEY = ['advisor', 'latest'] as const;

function toOrder(r: AdvisorReport): AdvisorOrder {
  return {
    order: r.advice.ordem.map((o) => ({ debt_id: o.debt_id, reason: o.motivo, suggested_cents: o.pagamento_sugerido_centavos })),
  };
}

async function functionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      /* corpo não-JSON */
    }
    if (ctx.status === 404) return 'O assistente ainda não foi publicado no Supabase. Veja o passo a passo no README.';
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'Sem conexão com a internet.';
  return 'Não foi possível falar com o assistente agora. Tente novamente.';
}

const IMPACT_TONE = { alto: 'danger', medio: 'warn', baixo: 'neutral' } as const;

export function AdvisorPanel({
  debts,
  available,
  order,
  onOrder,
}: {
  debts: DebtView[];
  available: number;
  order: AdvisorOrder | null;
  onOrder: (o: AdvisorOrder | null) => void;
}) {
  const qc = useQueryClient();
  const profile = useProfile().data;
  const [question, setQuestion] = useState('');

  const latest = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('advisor_reports')
        .select('id, created_at, model, question, available_cents, advice')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as AdvisorReport | undefined) ?? null;
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('advisor', {
        body: { available_cents: Math.max(0, Math.round(available)), question: question.trim() || null },
      });
      if (error) throw new Error(await functionError(error));
      return data as AdvisorReport;
    },
    onSuccess: (r) => {
      qc.setQueryData(KEY, r);
      setQuestion('');
    },
  });

  const report = run.data ?? latest.data ?? null;

  // A ordem da IA alimenta a lista assim que existe uma análise.
  useEffect(() => {
    onOrder(report ? toOrder(report) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id]);

  const consented = !!profile?.ai_consent_at;
  const hasContext = !!(profile?.occupation || profile?.financial_context || profile?.paydays?.length);
  const debtName = new Map(debts.map((d) => [d.id, d.creditor_name]));

  if (profile && !consented) {
    return (
      <section className="hero-soft space-y-3" aria-label="Assistente de IA">
        <p className="eyebrow">Assistente de IA</p>
        <h2 className="text-lg font-semibold tracking-tight">Uma segunda opinião sobre a sua ordem de pagamento</h2>
        <p className="text-sm text-muted">
          O assistente lê suas dívidas, contas, saldos e o seu perfil financeiro e sugere a sequência mais segura de
          pagamentos, explicando cada passo. Para isso, um resumo desses dados é enviado ao Claude (Anthropic) a cada análise.
          Nada é alterado sem você confirmar.
        </p>
        <Link to="/configuracoes#perfil-financeiro" className="btn-primary">Ativar e completar meu perfil</Link>
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-label="Assistente de IA">
      <div className="hero-soft space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">Assistente de IA</p>
          {report && <span className="text-xs text-muted">Última análise: {new Date(report.created_at).toLocaleString('pt-BR')}</span>}
        </div>
        {!hasContext && (
          <p className="rounded-xl bg-warn/10 px-3 py-2 text-xs">
            <strong className="text-warn">Dica:</strong> conte sua realidade em{' '}
            <Link className="link" to="/configuracoes#perfil-financeiro">Perfil financeiro</Link> (profissão, dias em que recebe,
            hábitos como usar o limite do cartão). A análise fica muito mais precisa.
          </p>
        )}
        <label className="label" htmlFor="ai-q">Algo que o assistente deve considerar agora? (opcional)</label>
        <textarea
          id="ai-q"
          className="input min-h-[72px]"
          maxLength={1000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ex.: recebo um extra de R$ 800 dia 20; não posso atrasar o empréstimo da minha irmã."
        />
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={run.isPending || (debts.length === 0 && !question.trim())} onClick={() => run.mutate()}>
            {run.isPending ? 'Analisando… (pode levar até 1 minuto)' : report ? 'Analisar de novo' : 'Analisar minha situação'}
          </button>
          <span className="text-xs text-muted">
            Considera <Money cents={available} /> disponíveis (campo de simulação acima).
          </span>
        </div>
        <FormError message={run.error ? (run.error as Error).message : null} />
      </div>

      {report && (
        <div className="stagger space-y-4">
          {report.advice.diagnostico && (
            <div className="card">
              <p className="eyebrow mb-2">Diagnóstico</p>
              <p className="text-sm leading-relaxed">{report.advice.diagnostico}</p>
            </div>
          )}

          {report.advice.alertas.length > 0 && (
            <div className="card border-expense/40">
              <p className="eyebrow mb-2 flex items-center gap-2 text-expense"><IconAlert width={14} height={14} /> Alertas</p>
              <ul className="space-y-1.5 text-sm">
                {report.advice.alertas.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </div>
          )}

          {report.advice.plano.length > 0 && (
            <div className="card">
              <p className="eyebrow mb-3">Plano passo a passo</p>
              <ol className="space-y-3">
                {report.advice.plano.map((p, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="icon-bubble h-8 w-8 shrink-0 rounded-xl bg-sunset text-xs text-[#1e0f05]">{i + 1}</span>
                    <div className="min-w-0 text-sm">
                      <p className="font-semibold">
                        {p.titulo}
                        {p.quando && <span className="ml-2 text-xs font-medium text-accent">{p.quando}</span>}
                      </p>
                      <p className="text-muted">{p.detalhe}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {report.advice.recomendacoes.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {report.advice.recomendacoes.map((r, i) => (
                <div key={i} className="card space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{r.titulo}</p>
                    <Badge tone={IMPACT_TONE[r.impacto]}>Impacto {r.impacto === 'medio' ? 'médio' : r.impacto}</Badge>
                  </div>
                  <p className="text-sm text-muted">{r.detalhe}</p>
                </div>
              ))}
            </div>
          )}

          {report.advice.perguntas.length > 0 && (
            <div className="card">
              <p className="eyebrow mb-2">Para melhorar a próxima análise</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                {report.advice.perguntas.map((q) => <li key={q}>{q}</li>)}
              </ul>
            </div>
          )}

          {order && order.order.length > 0 && (
            <p className="text-sm text-muted">
              Abaixo, suas dívidas na ordem sugerida pelo assistente
              {order.order.some((o) => o.suggested_cents) && ', com o valor sugerido para cada uma'}. Sua ordem manual só muda se
              você tocar em “Usar a ordem da IA”.
              {order.order.filter((o) => !debtName.has(o.debt_id)).length > 0 && ' Algumas dívidas mudaram desde a análise.'}
            </p>
          )}
          <p className="text-[11px] text-muted">
            Sugestões geradas por IA ({report.model}) com base nos seus dados. Podem conter erros e não substituem orientação
            profissional; as decisões são sempre suas.
          </p>
        </div>
      )}
    </section>
  );
}
