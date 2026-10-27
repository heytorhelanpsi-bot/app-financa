import { PageHeader } from '@/components/ui';

const CONTENT: Record<string, { title: string; phase: number; items: string[] }> = {
  ordem: {
    title: 'Ordem de Pagamento',
    phase: 2,
    items: [
      'Cadastro de dívidas com saldo devedor, juros, multa e consequências do atraso',
      'Fila manual com arrastar e soltar e botões de subir/descer',
      'Ordem sugerida com justificativa, sem substituir a escolha manual',
      'Simulação de pagamentos integrais e parciais sem alterar saldos reais',
      'Histórico de pagamentos e projeção do saldo após cada pagamento',
    ],
  },
  cartoes: {
    title: 'Cartões e Faturas',
    phase: 3,
    items: [
      'Cartões com limite, fechamento e vencimento',
      'Distribuição automática das parcelas nas faturas',
      'Pagamento de fatura sem contar as compras duas vezes',
      'Estornos, ajustes de centavos e pagamentos parciais',
    ],
  },
  calendario: {
    title: 'Calendário',
    phase: 3,
    items: ['Vencimentos, receitas previstas, faturas e parcelas por dia', 'Projeções de 7, 15 e 30 dias', 'Recorrências e parcelamentos'],
  },
  relatorios: {
    title: 'Relatórios',
    phase: 4,
    items: ['Receitas x despesas e gastos por categoria', 'Evolução do saldo e comprometimento da renda', 'Exportação em CSV e PDF'],
  },
};

export function ComingSoonPage({ area }: { area: keyof typeof CONTENT }) {
  const c = CONTENT[area];
  return (
    <div>
      <PageHeader title={c.title} subtitle={`Prevista para a Fase ${c.phase}. Ainda não disponível nesta versão.`} />
      <div className="card text-sm">
        <p className="mb-2 font-semibold">O que esta área terá:</p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          {c.items.map((i) => <li key={i}>{i}</li>)}
        </ul>
        {area === 'ordem' && (
          <p className="mt-4 text-muted">
            Enquanto isso, registre as contas a pagar em <strong>Movimentações</strong> com vencimento e situação “Pendente”: elas
            já entram no saldo comprometido da tela inicial e serão aproveitadas na Ordem de Pagamento.
          </p>
        )}
      </div>
    </div>
  );
}
