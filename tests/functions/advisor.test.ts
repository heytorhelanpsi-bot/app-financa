import { describe, expect, it } from 'vitest';
import {
  ADVICE_SCHEMA,
  MODEL,
  SYSTEM_PROMPT,
  buildUserMessage,
  daysBetween,
  handle,
  todayIn,
  validateAdvice,
} from '../../supabase/functions/advisor/index';

const debts = [
  { id: 'a', saldo_devedor_centavos: 100000 },
  { id: 'b', saldo_devedor_centavos: 5000 },
  { id: 'c', saldo_devedor_centavos: 30000 },
];

describe('validateAdvice', () => {
  it('descarta ids inventados e repetidos, limita pagamentos e completa dívidas omitidas', () => {
    const advice = validateAdvice(
      {
        diagnostico: 'Situação apertada.',
        ordem: [
          { debt_id: 'b', motivo: 'Dívida com amigo', pagamento_sugerido_centavos: 999999 },
          { debt_id: 'x', motivo: 'inventada', pagamento_sugerido_centavos: 100 },
          { debt_id: 'b', motivo: 'repetida', pagamento_sugerido_centavos: 1 },
          { debt_id: 'a', motivo: 'Juros altos', pagamento_sugerido_centavos: -5 },
        ],
        plano: [{ titulo: 'Pagar o amigo', detalhe: 'Hoje', quando: 'hoje' }],
        recomendacoes: [{ titulo: 'Parar o giro na maquininha', detalhe: '...', impacto: 'extremo', tipo: 'xyz' }],
        alertas: ['Cuidado'],
        perguntas: [],
      },
      debts,
    );
    expect(advice.ordem.map((o) => o.debt_id)).toEqual(['b', 'a', 'c']);
    expect(advice.ordem[0].pagamento_sugerido_centavos).toBe(5000);
    expect(advice.ordem[1].pagamento_sugerido_centavos).toBeNull();
    expect(advice.ordem[2].motivo).toMatch(/Não priorizada/);
    expect(advice.recomendacoes[0]).toMatchObject({ impacto: 'medio', tipo: 'organizar' });
  });

  it('tolera resposta vazia ou malformada', () => {
    const advice = validateAdvice(null, debts);
    expect(advice.ordem).toHaveLength(3);
    expect(advice.plano).toEqual([]);
    expect(advice.diagnostico).toBe('');
  });
});

describe('instruções e esquema', () => {
  it('usa o modelo padrão e pede resposta em português com os ids fornecidos', () => {
    expect(MODEL).toBe('claude-opus-5-5');
    expect(SYSTEM_PROMPT).toMatch(/português do Brasil/);
    expect(SYSTEM_PROMPT).toMatch(/maquininha/);
    expect(SYSTEM_PROMPT).toMatch(/exatamente uma vez/);
    expect(ADVICE_SCHEMA.required).toEqual(['diagnostico', 'ordem', 'plano', 'recomendacoes', 'alertas', 'perguntas']);
    expect(ADVICE_SCHEMA.additionalProperties).toBe(false);
  });

  it('serializa o retrato em JSON', () => {
    const msg = buildUserMessage({ hoje: '2026-10-27' } as never);
    expect(msg).toContain('"hoje": "2026-10-27"');
  });

  it('datas', () => {
    expect(daysBetween('2026-10-27', '2026-10-20')).toBe(7);
    expect(todayIn('America/Sao_Paulo', new Date('2026-10-28T01:30:00Z'))).toBe('2026-10-27');
  });
});

describe('handler', () => {
  it('responde ao preflight CORS e recusa sem chave configurada', async () => {
    const pre = await handle(new Request('http://x', { method: 'OPTIONS' }));
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const res = await handle(new Request('http://x', { method: 'POST' }));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/ANTHROPIC_API_KEY/);
  });
});
