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

Ordem de Pagamento, Cartões, Calendário e Relatórios aparecem no menu indicando a fase prevista; não há botões sem ação.

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
npm run test:db     # regras financeiras, RLS, idempotência e concorrência em PostgreSQL
```

`test:db` cria um banco temporário em um PostgreSQL local (padrão `postgres://postgres:postgres@localhost:5432/postgres`,
altere com `TEST_DATABASE_URL`), aplica uma emulação mínima do Supabase (`tests/db/supabase-shim.sql`) e as migrações.

Teste de navegador (opcional): `tests/e2e/mock-supabase.mjs` imita a API REST/Auth do Supabase sobre o PostgreSQL real
(RLS e funções verdadeiras; sem Realtime) e `tests/e2e/flow.cjs` percorre os critérios A, B, C, F, G e H com Playwright.

## Backup e recuperação

- Usuário: *Configurações → Seus dados → Backup completo (JSON)*.
- Administrador: backups automáticos do Supabase (planos pagos têm retenção diária e PITR opcional) ou
  `pg_dump` periódico com a connection string do projeto. Restauração: `psql`/`pg_restore` em um projeto novo e
  reaplicação das migrações pendentes.
