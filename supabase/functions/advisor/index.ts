// Assistente financeiro (Supabase Edge Function, Deno).
//
// Fluxo: valida a sessão do usuário → confere consentimento e limite diário →
// monta um retrato financeiro lendo o banco COM AS PERMISSÕES DO PRÓPRIO
// USUÁRIO (RLS) → pede ao Claude uma análise em JSON estruturado → valida a
// resposta → guarda em advisor_reports → devolve ao app.
//
// A chave ANTHROPIC_API_KEY fica apenas nos segredos das Edge Functions.
// Arquivo único, para poder ser colado no editor do painel do Supabase.
// As partes puras (prompt, esquema, validação) são exportadas e testadas.

import type AnthropicType from '@anthropic-ai/sdk';

declare const Deno:
  | {
      env: { get(name: string): string | undefined };
      serve(handler: (req: Request) => Response | Promise<Response>): void;
    }
  | undefined;

export const MODEL = 'claude-opus-5-5';
export const DAILY_LIMIT = 10;
const ANTHROPIC_MODULE = 'npm:@anthropic-ai/sdk@1.2.0';
const SUPABASE_MODULE = 'npm:@supabase/supabase-js@2.46.1';

// -----------------------------------------------------------------------------
// Tipos do retrato enviado ao modelo
// -----------------------------------------------------------------------------

export interface SnapshotDebt {
  id: string;
  credor: string;
  descricao: string | null;
  saldo_devedor_centavos: number;
  principal_em_aberto_centavos: number;
  encargos_em_aberto_centavos: number;
  valor_devido_no_vencimento_centavos: number;
  parcela_centavos: number | null;
  pagamento_minimo_centavos: number | null;
  parcelas_restantes: number | null;
  proximo_vencimento: string | null;
  dias_em_atraso: number | null;
  juros_mensal_percentual: number | null;
  multa_percentual: number | null;
  prioridade_informada: string;
  posicao_na_ordem_manual: number;
  essencial: boolean;
  consequencia_do_atraso: string;
  detalhes_consequencia: string | null;
  observacoes: string | null;
}

export interface Snapshot {
  hoje: string;
  perfil: {
    ocupacao: string | null;
    tipo_de_renda: string | null;
    renda_mensal_centavos: number | null;
    dias_de_recebimento: number[];
    contexto_pessoal: string | null;
  };
  dinheiro_disponivel_para_dividas_centavos: number;
  pergunta_do_usuario: string | null;
  saldos: {
    saldo_bancario_centavos: number;
    beneficios_restritos_centavos: number;
    comprometido_ate_fim_do_mes_centavos: number;
    livre_estimado_centavos: number;
    projetado_fim_do_mes_centavos: number;
    contas: { nome: string; tipo: string; saldo_centavos: number }[];
  };
  dividas: SnapshotDebt[];
  contas_em_aberto_proximos_45_dias: {
    descricao: string;
    tipo: 'receita' | 'despesa';
    situacao: string;
    valor_centavos: number;
    data: string;
    categoria: string | null;
  }[];
  ultimos_90_dias: {
    receitas_recebidas_centavos: number;
    despesas_pagas_centavos: number;
    despesas_por_categoria: { categoria: string; total_centavos: number }[];
  };
}

// -----------------------------------------------------------------------------
// Resposta estruturada
// -----------------------------------------------------------------------------

export interface Advice {
  diagnostico: string;
  ordem: { debt_id: string; motivo: string; pagamento_sugerido_centavos: number | null }[];
  plano: { titulo: string; detalhe: string; quando: string | null }[];
  recomendacoes: {
    titulo: string;
    detalhe: string;
    impacto: 'alto' | 'medio' | 'baixo';
    tipo: 'evitar_juros' | 'cortar_gasto' | 'renegociar' | 'organizar' | 'proteger_essencial' | 'aumentar_renda' | 'reserva';
  }[];
  alertas: string[];
  perguntas: string[];
}

export const ADVICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['diagnostico', 'ordem', 'plano', 'recomendacoes', 'alertas', 'perguntas'],
  properties: {
    diagnostico: { type: 'string', description: 'Resumo da situação em 2 a 4 frases.' },
    ordem: {
      type: 'array',
      description: 'Todas as dívidas em aberto, na ordem recomendada de pagamento.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['debt_id', 'motivo', 'pagamento_sugerido_centavos'],
        properties: {
          debt_id: { type: 'string' },
          motivo: { type: 'string', description: 'Uma frase curta explicando a posição.' },
          pagamento_sugerido_centavos: { type: ['integer', 'null'] },
        },
      },
    },
    plano: {
      type: 'array',
      description: 'Sequência prática de passos, em ordem cronológica.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titulo', 'detalhe', 'quando'],
        properties: {
          titulo: { type: 'string' },
          detalhe: { type: 'string' },
          quando: { type: ['string', 'null'], description: 'Ex.: "hoje", "dia 5, quando cair o salário".' },
        },
      },
    },
    recomendacoes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titulo', 'detalhe', 'impacto', 'tipo'],
        properties: {
          titulo: { type: 'string' },
          detalhe: { type: 'string' },
          impacto: { type: 'string', enum: ['alto', 'medio', 'baixo'] },
          tipo: {
            type: 'string',
            enum: ['evitar_juros', 'cortar_gasto', 'renegociar', 'organizar', 'proteger_essencial', 'aumentar_renda', 'reserva'],
          },
        },
      },
    },
    alertas: { type: 'array', items: { type: 'string' } },
    perguntas: {
      type: 'array',
      description: 'Informações que, se o usuário fornecer, melhorariam a análise.',
      items: { type: 'string' },
    },
  },
} as const;

export const SYSTEM_PROMPT = `Você é o assistente financeiro do app "Financeiro Pessoal", usado por pessoas no Brasil para organizar dívidas e pagamentos. Sua tarefa é analisar o retrato financeiro e o contexto pessoal do usuário e dizer, com clareza, em que ordem pagar as dívidas e o que fazer para não piorar a situação.

Como pensar:
- Leve a sério o contexto pessoal (profissão, estabilidade e datas da renda, hábitos descritos). Ele muda a recomendação: quem recebe em dias fixos pode sequenciar pagamentos pelas datas de entrada; quem usa o limite do cartão para conseguir dinheiro (por exemplo, passando o cartão em maquininha e pagando taxa) está num ciclo caro que deve ser apontado e desmontado aos poucos.
- A ordem manual e a prioridade informada refletem o que o usuário considera importante. Parta delas. Quando sugerir algo diferente, explique o motivo em uma frase.
- Proteja primeiro o essencial (moradia, energia, água, alimentação, saúde) e os compromissos que o usuário diz não poder atrasar, como dívidas com pessoas próximas.
- Com o essencial garantido, priorize as dívidas mais caras (juros e multas maiores) e as que geram consequências graves no atraso.
- Aponte ciclos caros: rotativo e parcelamento de fatura, cheque especial, "giro" de limite em maquininha. Quando houver dados, estime o custo mensal aproximado.
- Não recomende novos empréstimos como solução principal. Renegociação, portabilidade e redução de gastos vêm antes.
- Use somente os números fornecidos. Se faltar informação para uma conclusão, diga isso e inclua a pergunta em "perguntas".
- Em caso de superendividamento (dívidas que comprometem o mínimo para viver), mencione que existe a Lei 14.181/2021 e que Procon e Defensoria Pública podem ajudar a repactuar.

Formato:
- Valores monetários estão em centavos (inteiros). No texto, escreva em reais, por exemplo "R$ 1.250,00".
- Em "ordem", inclua cada dívida do retrato exatamente uma vez, usando o id fornecido, sem inventar ids. "pagamento_sugerido_centavos" deve caber no dinheiro disponível na sequência e nunca passar do saldo devedor; use null quando a dívida não deve receber pagamento agora.
- "plano": de 2 a 6 passos concretos, em ordem cronológica.
- "recomendacoes": de 2 a 6 itens, os mais importantes primeiro.
- Escreva em português do Brasil, em linguagem simples, direta e sem julgamentos. Isto não é consultoria financeira regulamentada; não é preciso repetir esse aviso.`;

export function buildUserMessage(snapshot: Snapshot): string {
  return [
    'Retrato financeiro atual do usuário (JSON). Analise e responda no formato pedido.',
    '',
    JSON.stringify(snapshot, null, 2),
  ].join('\n');
}

/**
 * Garante que a ordem contenha apenas dívidas existentes, sem repetição, com
 * pagamentos dentro do saldo; dívidas omitidas pelo modelo vão para o fim.
 */
export function validateAdvice(raw: unknown, debts: Pick<SnapshotDebt, 'id' | 'saldo_devedor_centavos'>[]): Advice {
  const a = (raw ?? {}) as Partial<Advice>;
  const str = (v: unknown, max = 1200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const byId = new Map(debts.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const ordem: Advice['ordem'] = [];
  for (const item of Array.isArray(a.ordem) ? a.ordem : []) {
    const d = byId.get(item?.debt_id);
    if (!d || seen.has(d.id)) continue;
    seen.add(d.id);
    const p = item.pagamento_sugerido_centavos;
    const pay = typeof p === 'number' && Number.isFinite(p) && p > 0 ? Math.min(Math.round(p), d.saldo_devedor_centavos) : null;
    ordem.push({ debt_id: d.id, motivo: str(item.motivo, 400) || 'Sem justificativa informada.', pagamento_sugerido_centavos: pay });
  }
  for (const d of debts) {
    if (!seen.has(d.id)) ordem.push({ debt_id: d.id, motivo: 'Não priorizada pelo assistente.', pagamento_sugerido_centavos: null });
  }
  const IMPACT = ['alto', 'medio', 'baixo'] as const;
  const KIND = ['evitar_juros', 'cortar_gasto', 'renegociar', 'organizar', 'proteger_essencial', 'aumentar_renda', 'reserva'] as const;
  return {
    diagnostico: str(a.diagnostico, 2000),
    ordem,
    plano: (Array.isArray(a.plano) ? a.plano : [])
      .slice(0, 8)
      .map((s) => ({ titulo: str(s?.titulo, 200), detalhe: str(s?.detalhe), quando: s?.quando ? str(s.quando, 120) : null }))
      .filter((s) => s.titulo),
    recomendacoes: (Array.isArray(a.recomendacoes) ? a.recomendacoes : [])
      .slice(0, 8)
      .map((r) => ({
        titulo: str(r?.titulo, 200),
        detalhe: str(r?.detalhe),
        impacto: (IMPACT as readonly string[]).includes(r?.impacto) ? r.impacto : 'medio',
        tipo: (KIND as readonly string[]).includes(r?.tipo) ? r.tipo : 'organizar',
      }))
      .filter((r) => r.titulo),
    alertas: (Array.isArray(a.alertas) ? a.alertas : []).map((x) => str(x, 400)).filter(Boolean).slice(0, 6),
    perguntas: (Array.isArray(a.perguntas) ? a.perguntas : []).map((x) => str(x, 300)).filter(Boolean).slice(0, 5),
  };
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function endOfMonth(d: string): string {
  const dt = new Date(`${d.slice(0, 7)}-01T00:00:00Z`);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function addDays(d: string, n: number): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

const CONSEQ: Record<string, string> = {
  service_cut: 'corte de serviço essencial',
  asset_loss: 'perda de bem ou moradia',
  personal_trust: 'dívida com pessoa próxima; não pode atrasar',
  legal_action: 'cobrança judicial',
  credit_restriction: 'nome negativado',
  high_interest: 'juros altos',
  other: 'outra',
  none: 'nenhuma grave',
};

// -----------------------------------------------------------------------------
// Handler HTTP
// -----------------------------------------------------------------------------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function buildSnapshot(db: Db, availableCents: number, question: string | null): Promise<Snapshot> {
  const [profileR, balancesR, debtsR, debtBalR, catsR] = await Promise.all([
    db.from('profiles').select('*').single(),
    db.from('account_balances').select('*').eq('is_active', true),
    db.from('debts').select('*').eq('debt_status', 'active').order('priority_rank'),
    db.from('debt_balances').select('*'),
    db.from('categories').select('id, name'),
  ]);
  for (const r of [profileR, balancesR, debtsR, debtBalR, catsR]) if (r.error) throw r.error;

  const today = todayIn(profileR.data.timezone ?? 'America/Sao_Paulo');
  const sumR = await db.rpc('financial_summary', { p_start: today, p_end: endOfMonth(today) });
  if (sumR.error) throw sumR.error;
  const s = sumR.data;

  const since = addDays(today, -90);
  const [openR, settledR] = await Promise.all([
    db
      .from('transactions')
      .select('description, transaction_type, status, amount_cents, ref_date, category_id')
      .in('status', ['forecast', 'pending'])
      .lte('ref_date', addDays(today, 45))
      .order('ref_date')
      .limit(200),
    db
      .from('transactions')
      .select('transaction_type, settled_amount_cents, category_id')
      .in('status', ['paid', 'received'])
      .in('transaction_type', ['income', 'expense'])
      .is('reversed_at', null)
      .gte('settled_at', since)
      .limit(5000),
  ]);
  if (openR.error) throw openR.error;
  if (settledR.error) throw settledR.error;

  const catName = new Map<string, string>((catsR.data ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
  const balances = new Map<string, Record<string, number | null>>((debtBalR.data ?? []).map((b: { debt_id: string }) => [b.debt_id, b]));
  const p = profileR.data;

  const byCategory = new Map<string, number>();
  let income = 0;
  let expense = 0;
  for (const t of settledR.data ?? []) {
    const v = Number(t.settled_amount_cents);
    if (t.transaction_type === 'income') income += v;
    else {
      expense += v;
      const k = (t.category_id && catName.get(t.category_id)) || 'Sem categoria';
      byCategory.set(k, (byCategory.get(k) ?? 0) + v);
    }
  }

  const debts: SnapshotDebt[] = (debtsR.data ?? []).map((d: Record<string, any>, i: number) => {
    const b = balances.get(d.id) ?? {};
    const outstanding = Number(b.outstanding_cents ?? d.original_amount_cents);
    const due = Math.min(outstanding, Number(d.installment_amount_cents ?? d.minimum_payment_cents ?? outstanding));
    const late = d.next_due_date ? daysBetween(today, d.next_due_date) : null;
    return {
      id: d.id,
      credor: d.creditor_name,
      descricao: d.description,
      saldo_devedor_centavos: outstanding,
      principal_em_aberto_centavos: Number(b.principal_outstanding_cents ?? outstanding),
      encargos_em_aberto_centavos: Number(b.charges_outstanding_cents ?? 0),
      valor_devido_no_vencimento_centavos: due,
      parcela_centavos: d.installment_amount_cents,
      pagamento_minimo_centavos: d.minimum_payment_cents,
      parcelas_restantes: d.installments_total,
      proximo_vencimento: d.next_due_date,
      dias_em_atraso: late !== null && late > 0 ? late : null,
      juros_mensal_percentual: d.interest_rate_monthly === null ? null : Number(d.interest_rate_monthly),
      multa_percentual: d.late_fee_percent === null ? null : Number(d.late_fee_percent),
      prioridade_informada: d.priority_level,
      posicao_na_ordem_manual: i + 1,
      essencial: d.is_essential,
      consequencia_do_atraso: CONSEQ[d.late_consequence] ?? d.late_consequence,
      detalhes_consequencia: d.consequence_notes,
      observacoes: d.notes,
    };
  }).filter((d: SnapshotDebt) => d.saldo_devedor_centavos > 0);

  return {
    hoje: today,
    perfil: {
      ocupacao: p.occupation,
      tipo_de_renda: p.income_type,
      renda_mensal_centavos: p.monthly_income_cents === null ? null : Number(p.monthly_income_cents),
      dias_de_recebimento: p.paydays ?? [],
      contexto_pessoal: p.financial_context,
    },
    dinheiro_disponivel_para_dividas_centavos: availableCents,
    pergunta_do_usuario: question,
    saldos: {
      saldo_bancario_centavos: Number(s.bank_balance_cents),
      beneficios_restritos_centavos: Number(s.benefit_balance_cents),
      comprometido_ate_fim_do_mes_centavos: Number(s.committed_cents),
      livre_estimado_centavos: Number(s.free_cents),
      projetado_fim_do_mes_centavos: Number(s.projected_end_cents),
      contas: (balancesR.data ?? []).map((a: Record<string, any>) => ({
        nome: a.name,
        tipo: a.account_type,
        saldo_centavos: Number(a.balance_cents),
      })),
    },
    dividas: debts,
    contas_em_aberto_proximos_45_dias: (openR.data ?? []).map((t: Record<string, any>) => ({
      descricao: t.description,
      tipo: t.transaction_type === 'income' ? 'receita' : 'despesa',
      situacao: t.status === 'forecast' ? 'prevista' : t.ref_date < today ? 'vencida' : 'pendente',
      valor_centavos: Number(t.amount_cents),
      data: t.ref_date,
      categoria: (t.category_id && catName.get(t.category_id)) || null,
    })),
    ultimos_90_dias: {
      receitas_recebidas_centavos: income,
      despesas_pagas_centavos: expense,
      despesas_por_categoria: [...byCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([categoria, total_centavos]) => ({ categoria, total_centavos })),
    },
  };
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Método não permitido.' });

  const env = (name: string) => (typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined);
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) return reply(503, { error: 'Assistente não configurado: defina o segredo ANTHROPIC_API_KEY nas Edge Functions.' });

  const auth = req.headers.get('Authorization');
  if (!auth) return reply(401, { error: 'Sessão inválida. Entre novamente.' });

  const { createClient } = await import(SUPABASE_MODULE);
  // Cliente com o JWT do usuário: todas as leituras respeitam RLS.
  const db = createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await db.auth.getUser();
  if (userErr || !userData?.user) return reply(401, { error: 'Sessão inválida. Entre novamente.' });

  let body: { available_cents?: unknown; question?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* corpo vazio é aceito */
  }
  const available = Number.isSafeInteger(body.available_cents) && (body.available_cents as number) >= 0 ? (body.available_cents as number) : 0;
  const question = typeof body.question === 'string' && body.question.trim() ? body.question.trim().slice(0, 1000) : null;

  const profile = await db.from('profiles').select('ai_consent_at').single();
  if (profile.error) return reply(500, { error: 'Não foi possível ler o perfil.' });
  if (!profile.data.ai_consent_at) {
    return reply(403, { error: 'Ative o assistente de IA em Configurações → Perfil financeiro para permitir a análise.' });
  }

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const count = await db.from('advisor_reports').select('id', { count: 'exact', head: true }).gte('created_at', since);
  if ((count.count ?? 0) >= DAILY_LIMIT) {
    return reply(429, { error: `Limite de ${DAILY_LIMIT} análises por dia atingido. Tente novamente amanhã.` });
  }

  let snapshot: Snapshot;
  try {
    snapshot = await buildSnapshot(db, available, question);
  } catch {
    return reply(500, { error: 'Não foi possível reunir seus dados para a análise.' });
  }
  if (snapshot.dividas.length === 0 && !question) {
    return reply(400, { error: 'Cadastre ao menos uma dívida ou escreva uma pergunta para o assistente.' });
  }

  const { default: Anthropic } = (await import(ANTHROPIC_MODULE)) as { default: typeof AnthropicType };
  const client = new Anthropic({ apiKey });

  let message: AnthropicType.Beta.BetaMessage;
  try {
    message = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      // Se o modelo recusar por política, a API refaz o pedido em um modelo de reserva.
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: ADVICE_SCHEMA as unknown as Record<string, unknown> } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(snapshot) }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return reply(503, { error: 'Assistente ocupado no momento. Tente em alguns minutos.' });
    if (err instanceof Anthropic.AuthenticationError) return reply(503, { error: 'Chave da Anthropic inválida. Revise o segredo ANTHROPIC_API_KEY.' });
    if (err instanceof Anthropic.APIError) return reply(502, { error: 'O assistente não respondeu. Tente novamente.' });
    return reply(502, { error: 'Falha de comunicação com o assistente. Tente novamente.' });
  }

  if (message.stop_reason === 'refusal') {
    return reply(422, { error: 'O assistente não pôde analisar este pedido. Reformule a pergunta e tente de novo.' });
  }
  if (message.stop_reason === 'max_tokens') {
    return reply(502, { error: 'A resposta do assistente ficou incompleta. Tente novamente.' });
  }
  const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return reply(502, { error: 'Resposta do assistente em formato inesperado. Tente novamente.' });
  }
  const advice = validateAdvice(parsed, snapshot.dividas);

  const saved = await db
    .from('advisor_reports')
    .insert({
      model: message.model,
      question,
      available_cents: available,
      advice,
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
    })
    .select('id, created_at, model, question, available_cents, advice')
    .single();
  if (saved.error) return reply(500, { error: 'A análise foi gerada, mas não pôde ser salva.' });

  return reply(200, saved.data);
}

if (typeof Deno !== 'undefined') Deno.serve(handle);
