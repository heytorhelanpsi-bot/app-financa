# Financeiro Pessoal Inteligente — Arquitetura

## 1. Arquitetura escolhida

| Camada | Tecnologia | Por quê |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Tipagem estática, build rápido, ecossistema maduro. |
| Interface | Tailwind CSS, componentes próprios | Tema escuro/claro por variáveis CSS; sem dependência de kit visual. |
| Dados no cliente | TanStack Query | Cache, revalidação ao focar a janela e invalidação após cada operação. |
| Banco | PostgreSQL gerenciado pelo Supabase | Relacional, transações ACID, `numeric`/`bigint`, RLS nativo. |
| Autenticação | Supabase Auth (e-mail e senha, recuperação por e-mail) | Integrado ao RLS via `auth.uid()`. |
| Backend | Funções SQL (RPC) + triggers no próprio Postgres | Regras financeiras executadas no servidor, na mesma transação dos dados. Não há servidor intermediário para manter. |
| Sincronização | Supabase Realtime (`postgres_changes`) + revalidação | Avisos de alteração respeitam RLS; o cliente sempre relê do servidor. |
| Instalação | PWA (vite-plugin-pwa) | Manifesto, ícones, service worker que guarda só a casca do app. |

**Por que regras no banco e não em Edge Functions:** pagamento, transferência, estorno e ajuste precisam ser atômicos e
resistentes a pedidos duplicados. Funções `plpgsql` rodam dentro de uma transação, usam bloqueio de linha e não
dependem de rede entre serviços. Elas são `SECURITY INVOKER`: executam com as permissões do usuário, portanto RLS
continua valendo. Edge Functions ficam reservadas para integrações externas (Open Finance, Fase 4), onde há segredos.

**Plataforma:** o código não depende de recursos exclusivos de um host. O build é estático (`dist/`) e roda em Vercel,
Netlify, Cloudflare Pages ou similar (`vercel.json` e `public/_redirects` já configuram o fallback de SPA).

## 2. Modelo de dados (Fase 1)

```
auth.users ─1:1─ profiles
     │
     ├─1:N─ accounts ──────────────┐
     ├─1:N─ categories (parent_id → categories, 1 nível)
     ├─1:N─ transactions ── account_id → accounts
     │                    ├─ category_id → categories
     │                    ├─ reversal_of_id → transactions (estorno)
     │                    └─ transfer_group_id (agrupa as 2 pontas)
     ├─1:N─ idempotency_keys
     └─1:N─ audit_logs (gravado só por trigger)
```

Decisões:

- **Dinheiro em centavos (`bigint`)**, com limite de 10¹⁴. No navegador, o texto digitado é convertido por manipulação
  de dígitos (`src/lib/money.ts`), nunca por `parseFloat`.
- **Chaves estrangeiras compostas `(id, user_id)`**: um lançamento não consegue apontar para conta ou categoria de outro
  usuário, mesmo que o ID seja descoberto.
- **Saldo nunca é armazenado.** A view `account_balances` calcula `saldo inicial + entradas efetivadas − saídas
  efetivadas`. O saldo inicial fica bloqueado depois que a conta tem lançamentos; correções usam *Ajustar saldo*, que cria
  um lançamento `adjustment` rastreável.
- **`version`** em todas as tabelas editáveis: toda edição envia a versão lida; se outro dispositivo alterou antes, a
  atualização não afeta linhas e o usuário é avisado (controle otimista de conflitos).
- **`ref_date`** (coluna gerada) = data efetiva, senão vencimento, senão competência — usada para listar e filtrar.
- **Auditoria:** trigger `SECURITY DEFINER` grava `audit_logs` (valores antigos e novos + contexto da operação). O
  usuário só pode ler; não pode inserir, alterar ou apagar.

Tabelas das próximas fases (debts, debt_payments, credit_cards, invoices, invoice_items, installments, recurrences,
financial_connections, import_batches, notifications) serão criadas em migrações próprias, seguindo os mesmos padrões
(centavos, FK composta, RLS, `version`). `transactions` receberá `credit_card_id`, `invoice_id`, `installment_id` e
`recurrence_id` nessas migrações.

### Datas

| Campo | Significado | Usado em |
|---|---|---|
| `competence_date` | A que mês/dia o fato pertence (ex.: conta de luz de setembro). | Relatórios por competência. |
| `due_date` | Data limite para pagar ou receber. | Planejamento, “vencido”, projeção. |
| `settled_at` | Data em que o dinheiro saiu ou entrou de fato. | Saldo bancário. |

### Estados de um lançamento

`forecast` (previsto, incerto) → `pending` (confirmado, a pagar) → `paid`/`received` (efetivado), ou `canceled`.
**Vencido** não é armazenado: é qualquer lançamento em aberto com data de referência anterior a hoje (no fuso do usuário).

## 3. Regras de cálculo

Notação: *efetivados* = `paid` ou `received`; *em aberto* = `forecast` ou `pending`.

| Indicador | Fórmula |
|---|---|
| Saldo de uma conta | `opening_balance + Σ entradas efetivadas − Σ saídas efetivadas` |
| **Saldo bancário atual** | Σ saldo das contas ativas **exceto** benefícios |
| Benefícios | Σ saldo das contas `benefit` (exibido à parte, nunca somado ao dinheiro livre) |
| **Comprometido** | Σ despesas em aberto (pendentes + previstas, opcional) com data de referência ≤ fim do período, incluindo vencidas |
| **Livre estimado** | bancário − comprometido + receitas que o usuário escolhe considerar (pendentes e/ou previstas) |
| **Projetado no fim do período** | bancário + todas as receitas em aberto − todas as despesas em aberto até o fim do período |
| Pagas / recebidas no período | Σ `settled_amount` de receitas/despesas efetivadas no período, excluindo estornadas |

Garantias (todas verificadas por testes automatizados):

1. Transferência = duas linhas `transfer` (saída + entrada) criadas juntas; não entra em receitas nem despesas.
2. Receita prevista ou pendente não altera o saldo efetivo.
3. Despesa pendente não é saída bancária.
4. Efetivar exige conta, data efetiva e valor efetivo; só a RPC `settle_transaction` faz essa transição.
5. Lançamento efetivado não tem valor, conta, data efetiva ou status alterados nem é excluído — usa-se **estorno**, que
   cria um lançamento inverso e marca o original; opcionalmente reabre uma cópia pendente para nova confirmação.
6. Despesas lançadas em conta-benefício não reduzem o saldo livre em dinheiro.
7. Data efetiva não pode ser anterior à data do saldo inicial da conta (evita contar o mesmo movimento duas vezes).
8. Lançamentos em aberto não podem ser arquivados (não somem do planejamento).

Regra para a Fase 3 (cartões): compras no cartão serão despesas consolidadas **na data da compra** e farão parte da
fatura; o pagamento da fatura será uma saída bancária do tipo `invoice_payment`, que não é despesa consolidada.
Projeções considerarão a fatura (e não as compras individuais) para não descontar duas vezes.

## 4. Segurança e integridade

- RLS habilitado em todas as tabelas; políticas `user_id = auth.uid()`; `anon` sem nenhum privilégio.
- Funções auxiliares no schema `app_private`, que não é exposto pela API.
- Transferências, ajustes e estornos só podem ser criados pelas RPCs (trigger recusa inserção direta).
- **Idempotência:** as RPCs críticas exigem uma chave UUID gerada pelo dispositivo ao abrir o formulário. Repetir o pedido
  devolve o mesmo resultado; pedidos simultâneos com a mesma chave aguardam o primeiro terminar.
- **Concorrência:** a confirmação usa `UPDATE … WHERE status IN ('forecast','pending')`, que bloqueia a linha; uma segunda
  confirmação simultânea reavalia o filtro e é recusada. Estornos usam `SELECT … FOR UPDATE`.
- Novos lançamentos usam ID gerado no dispositivo com `INSERT … ON CONFLICT DO NOTHING`: reenvio não duplica.
- Mensagens de regra de negócio são escritas em português no banco; demais erros chegam ao usuário de forma genérica.
- Somente a chave pública (anon) vai para o navegador. A `service_role` nunca deve estar em variáveis `VITE_*`.

## 5. Plano por fases

| Fase | Conteúdo | Estado |
|---|---|---|
| 1 — Fundação | Autenticação, banco, RLS, layout responsivo, contas, categorias, receitas/despesas, transferências, ajustes, estornos, resumo da tela inicial, sincronização, exportação, PWA | **Implementada** |
| 2 — Dívidas | `debts`, `debt_payments`, Ordem de Pagamento manual (arrastar/soltar + subir/descer), ordem sugerida com justificativa, simulação sem efeito no saldo, pagamentos parciais com principal/juros, projeção diária | Próxima |
| 3 — Cartões e compromissos | Cartões, faturas, parcelamentos, recorrências (geração idempotente por `(recurrence_id, occurrence_date)` único), calendário, projeções 7/15/30 dias | Planejada |
| 4 — Avançado | Relatórios, PDF, importação CSV/OFX com conciliação, alertas, camada de provedores Open Finance | Planejada |

## 6. Limitações e custos externos

- **Supabase:** o plano gratuito atende ao desenvolvimento, mas pausa projetos inativos e tem backups limitados. Para uso
  real recomenda-se o plano pago (backups diários e recuperação). Consulte os valores atuais em supabase.com/pricing.
- **E-mail de autenticação:** o SMTP padrão do Supabase tem limite baixo de envios por hora; em produção configure um SMTP
  próprio (ex.: Resend, SES).
- **Hospedagem estática:** planos gratuitos de Vercel/Netlify/Cloudflare Pages costumam bastar para uso pessoal.
- **Open Finance:** exige provedor autorizado/agregador (ex.: Pluggy, Belvo, Celcoin e outros). Nenhum foi contratado;
  custos, cobertura de instituições e limites precisam ser comparados antes da Fase 4. Até lá **não há sincronização
  bancária automática** e o app não pede nem guarda senhas bancárias.
- **Modo offline:** o PWA abre sem internet, mas alterações exigem conexão (o app avisa e não enfileira operações
  financeiras, para evitar duplicidades e conflitos silenciosos).
