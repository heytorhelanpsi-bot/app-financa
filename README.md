# Financeiro Pessoal Inteligente

Aplicativo web instalável (PWA) para controle financeiro pessoal com foco em dívidas, ordem de pagamento e saldo
realmente disponível. React + TypeScript no frontend; PostgreSQL/Supabase com RLS e regras financeiras no banco.

Arquitetura, modelo de dados, regras de cálculo e plano de fases: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Estado atual — Fase 1 (Fundação)

- Cadastro, login, saída e recuperação de senha (Supabase Auth).
- Contas bancárias, carteira e benefícios de uso restrito; saldo calculado a partir das movimentações; ajuste de saldo
  rastreável; transferências entre contas próprias.
- Receitas e despesas: criar, editar, duplicar, cancelar, arquivar, excluir (somente em aberto), confirmar pagamento ou
  recebimento (conta, data e valor efetivos) e estornar.
- Categorias padrão + personalizadas, subcategorias, reordenação, desativação.
- Tela inicial: saldo bancário, comprometido, livre estimado, projetado no fim do período, despesas e receitas
  separadas por estado, vencidos, filtros de período (semana, mês, próximo mês, personalizado) e cenário configurável.
- Sincronização entre dispositivos (Realtime + revalidação), indicador de conexão, controle de conflitos por versão.
- Exportação de backup completo (JSON) e de movimentações (CSV).
- Tema escuro (padrão) e claro; navegação inferior no celular e menu lateral no desktop.

Cartões, Calendário e Relatórios aparecem no menu indicando a fase prevista; não há botões sem ação.

## Fase 2 — Controle de dívidas e assistente de IA

- **Ordem de Pagamento:** cadastro de dívidas (credor, saldo devedor, parcela, mínimo, vencimento, juros, multa,
  prioridade, consequência do atraso, essencialidade), ordem manual com arrastar-e-soltar e botões subir/descer,
  ordem sugerida com justificativa (não substitui a manual sem confirmação), simulação de pagamentos integrais,
  parciais ou personalizados com o dinheiro disponível (sem alterar saldos), pagamento confirmado que gera a saída
  bancária e o histórico, encargos/descontos rastreáveis e estorno que reabre a dívida.
- **Projeção do saldo** dia a dia na tela inicial, incluindo parcelas de dívidas; o comprometido passa a considerá-las.
- **Assistente de IA (opcional):** lê o seu perfil financeiro (ocupação, renda, dias de recebimento e um texto livre
  sobre a sua realidade), saldos, dívidas e contas, e devolve diagnóstico, ordem recomendada com motivos, plano passo a
  passo, recomendações e alertas. Só funciona com o seu consentimento em *Configurações → Perfil financeiro* e roda
  numa Edge Function do Supabase com o modelo Claude Opus 5.5.

### Publicar a Fase 2 (pelo painel do Supabase)

1. **Banco:** no *SQL Editor*, rode `supabase/migrations/20261028000001_fase2_dividas.sql` (uma vez, depois da Fase 1).
2. **Assistente de IA** (opcional):
   1. Crie uma chave de API em [platform.claude.com](https://platform.claude.com) (exige cadastro de pagamento; cobrança
      por uso).
   2. No Supabase: *Edge Functions → Secrets* → adicione `ANTHROPIC_API_KEY` com a chave. Nunca coloque essa chave
      na Vercel nem em variáveis `VITE_*`.
   3. *Edge Functions → Deploy a new function → Via editor*, nome **`advisor`**, cole todo o conteúdo de
      `supabase/functions/advisor/index.ts` e publique (mantenha "Verify JWT" ligado). Pela CLI:
      `supabase functions deploy advisor`.
   4. No app, ative em *Configurações → Perfil financeiro* e use a aba *Assistente IA* em *Ordem de Pagamento*.

**Custo do assistente:** cada análise envia um resumo de alguns milhares de tokens e recebe a resposta; ao preço do
Claude Opus 5.5 (US$ 4 por milhão de tokens de entrada e US$ 20 por milhão de saída) isso fica, em geral, na casa de
alguns centavos de dólar por análise. O app limita a 10 análises por dia por usuário. Acompanhe o gasto no painel da
Anthropic.

## Como colocar no ar

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Aplique a migração `supabase/migrations/20261027000001_fase1_fundacao.sql`:
   - pelo **SQL Editor** do painel (cole e execute), ou
   - com a CLI: `supabase link --project-ref <ref>` e `supabase db push`.
3. Em **Authentication → URL Configuration**, defina a *Site URL* (endereço do app) e adicione
   `<seu-endereço>/redefinir-senha` às *Redirect URLs*.
4. Copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
   (Project Settings → API; use apenas a chave pública).
5. `npm install` e `npm run dev` para desenvolver, ou `npm run build` e publique a pasta `dist/` (Vercel, Netlify,
   Cloudflare Pages…). Configure as mesmas variáveis no provedor de hospedagem.

## Testes

```bash
npm run typecheck   # TypeScript
npm run test:unit   # conversão monetária, datas, CSV
npm run test:db     # regras financeiras, RLS, idempotência e concorrência em PostgreSQL (Fases 1 e 2)
```

`test:db` cria um banco temporário em um PostgreSQL local (padrão `postgres://postgres:postgres@localhost:5432/postgres`,
altere com `TEST_DATABASE_URL`), aplica uma emulação mínima do Supabase (`tests/db/supabase-shim.sql`) e as migrações.

Teste de navegador (opcional): `tests/e2e/mock-supabase.mjs` imita a API REST/Auth do Supabase sobre o PostgreSQL real
(RLS e funções verdadeiras; sem Realtime) e `tests/e2e/flow.cjs` percorre os critérios A, B, C, F, G e H com Playwright; `tests/e2e/fase2.cjs` cobre
dívidas, ordem, simulação, o Teste D e o painel do assistente (com resposta simulada, sem IA real).

## Backup e recuperação

- Usuário: *Configurações → Seus dados → Backup completo (JSON)*.
- Administrador: backups automáticos do Supabase (planos pagos têm retenção diária e PITR opcional) ou
  `pg_dump` periódico com a connection string do projeto. Restauração: `psql`/`pg_restore` em um projeto novo e
  reaplicação das migrações pendentes.
