import { useMemo, useState } from 'react';
import { Badge, ConfirmDialog, EmptyState, Money, PageHeader, QueryError, Spinner, Toggle, useToast } from '@/components/ui';
import { IconAlert, IconDown, IconUp } from '@/components/icons';
import { useDebts, useReorderDebts, useSummary } from '@/hooks/data';
import { useToday } from '@/hooks/useToday';
import { centsToInput, parseMoneyToCents } from '@/lib/money';
import { endOfMonth, formatDate } from '@/lib/dates';
import { friendlyError } from '@/lib/errors';
import {
  CONSEQUENCE_LABEL,
  PRIORITY_LABEL,
  buildDebtView,
  moveItem,
  simulate,
  suggestOrder,
  type DebtView,
  type PlanChoice,
  type PlanItem,
  type SimRow,
} from '@/features/debts/logic';
import { SortableList } from '@/features/debts/SortableList';
import { ChargeDialog, DebtDetails, DebtForm, PayDebtDialog } from '@/features/debts/DebtDialogs';
import { AdvisorPanel, type AdvisorOrder } from '@/features/advisor/AdvisorPanel';

type Mode = 'manual' | 'suggested' | 'ai';

const PLAN_LABEL: Record<PlanChoice, string> = {
  due: 'Parcela',
  minimum: 'Mínimo',
  full: 'Quitar',
  custom: 'Outro valor',
  skip: 'Não pagar',
};

const STATUS_BADGE: Record<SimRow['status'], { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' }> = {
  covered: { label: 'Coberta', tone: 'ok' },
  partial: { label: 'Parcial', tone: 'warn' },
  uncovered: { label: 'Fica pendente', tone: 'danger' },
  skipped: { label: 'Fora do plano', tone: 'neutral' },
};

const LEVEL_TONE = { critical: 'danger', high: 'warn', medium: 'neutral', low: 'neutral' } as const;

export function PaymentOrderPage() {
  const today = useToday();
  const debtsQuery = useDebts();
  const reorder = useReorderDebts();
  const toast = useToast();
  const summary = useSummary({
    start: today,
    end: endOfMonth(today),
    includeForecastExpenses: true,
    includePendingIncome: false,
    includeForecastIncome: false,
  });

  const [mode, setMode] = useState<Mode>('manual');
  const [availableInput, setAvailableInput] = useState<string | null>(null);
  const [allowPartial, setAllowPartial] = useState(false);
  const [plan, setPlan] = useState<Record<string, PlanItem>>({});
  const [aiOrder, setAiOrder] = useState<AdvisorOrder | null>(null);
  const [confirmApply, setConfirmApply] = useState<string[] | null>(null);
  const [form, setForm] = useState<{ open: boolean; debt?: DebtView }>({ open: false });
  const [paying, setPaying] = useState<{ debt: DebtView; cents?: number } | null>(null);
  const [charging, setCharging] = useState<DebtView | null>(null);
  const [details, setDetails] = useState<DebtView | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const views = useMemo(() => {
    const data = debtsQuery.data;
    if (!data) return [];
    const balances = new Map(data.balances.map((b) => [b.debt_id, b]));
    return data.debts.map((d) => buildDebtView(d, balances.get(d.id), today));
  }, [debtsQuery.data, today]);

  const active = views.filter((d) => d.debt_status === 'active' && d.outstanding > 0);
  const closed = views.filter((d) => !(d.debt_status === 'active' && d.outstanding > 0));

  // Dinheiro disponível para dívidas = saldo livre do mês antes de descontar as parcelas.
  const s = summary.data;
  const defaultAvailable = s ? Math.max(0, Number(s.free_cents) + Number(s.debts.due_cents)) : 0;
  const parsedAvailable = availableInput === null ? defaultAvailable : parseMoneyToCents(availableInput) ?? 0;

  const suggestions = useMemo(() => suggestOrder(active, parsedAvailable), [active, parsedAvailable]);
  const suggestedReasons = new Map(suggestions.map((x) => [x.debt.id, x.reasons]));

  const ordered: DebtView[] = useMemo(() => {
    if (mode === 'suggested') return suggestions.map((x) => x.debt);
    if (mode === 'ai' && aiOrder) {
      const byId = new Map(active.map((d) => [d.id, d]));
      const listed = aiOrder.order.map((o) => byId.get(o.debt_id)).filter((d): d is DebtView => !!d);
      return [...listed, ...active.filter((d) => !aiOrder.order.some((o) => o.debt_id === d.id))];
    }
    return active;
  }, [mode, suggestions, aiOrder, active]);

  const effectivePlan: Record<string, PlanItem> = { ...plan };
  if (mode === 'ai' && aiOrder) {
    for (const o of aiOrder.order) {
      if (!plan[o.debt_id]) effectivePlan[o.debt_id] = o.suggested_cents ? { choice: 'custom', customCents: o.suggested_cents } : { choice: 'skip' };
    }
  }
  const sim = simulate(ordered, parsedAvailable, effectivePlan, allowPartial);
  const simById = new Map(sim.rows.map((r) => [r.debt.id, r]));
  const aiReasons = new Map((aiOrder?.order ?? []).map((o) => [o.debt_id, o.reason]));

  if (debtsQuery.isLoading) return <Spinner />;
  if (debtsQuery.error) return <QueryError error={debtsQuery.error} onRetry={() => debtsQuery.refetch()} />;

  const totalOutstanding = active.reduce((sum, d) => sum + d.outstanding, 0);
  const overdue = active.filter((d) => d.daysOverdue !== null);
  const dueSoon = active.filter((d) => d.daysToDue !== null && d.daysToDue <= 30);

  const saveOrder = (ids: string[]) =>
    reorder.mutate(ids, {
      onSuccess: () => toast('Ordem salva.'),
      onError: (e) => toast(friendlyError(e), 'error'),
    });

  const move = (index: number, dir: -1 | 1) => {
    const ids = active.map((d) => d.id);
    const next = moveItem(ids, index, index + dir);
    if (next !== ids) saveOrder(next);
  };

  const setChoice = (id: string, item: PlanItem) => setPlan((p) => ({ ...p, [id]: item }));

  return (
    <div className="stagger space-y-6">
      <PageHeader
        title="Ordem de Pagamento"
        subtitle="Defina o que pagar primeiro, simule com o dinheiro que você tem e só então confirme."
        actions={<button className="btn-primary" onClick={() => setForm({ open: true })}>+ Nova dívida</button>}
      />

      {/* Resumo */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="hero col-span-2 p-6 sm:col-span-1">
          <div className="hero-sun" aria-hidden />
          <p className="eyebrow">Total em dívidas</p>
          <Money cents={totalOutstanding} className="mt-2 block text-3xl font-semibold tracking-tight" />
          <p className="mt-1 text-xs text-muted">{active.length} dívida(s) em aberto</p>
        </div>
        <div className="card">
          <p className="eyebrow">Vencidas</p>
          <Money cents={overdue.reduce((x, d) => x + d.amountDue, 0)} className={`mt-2 block text-2xl font-semibold ${overdue.length ? 'text-expense' : ''}`} />
          <p className="mt-1 text-xs text-muted">{overdue.length ? `${overdue.length} em atraso` : 'Nenhuma em atraso'}</p>
        </div>
        <div className="card">
          <p className="eyebrow">A vencer em 30 dias</p>
          <Money cents={dueSoon.reduce((x, d) => x + d.amountDue, 0)} className="mt-2 block text-2xl font-semibold" />
          <p className="mt-1 text-xs text-muted">{dueSoon.length} vencimento(s)</p>
        </div>
      </div>

      {/* Simulação */}
      <section className="card space-y-4" aria-label="Simulação">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-[220px] flex-1">
            <label className="label" htmlFor="avail">Dinheiro disponível para as dívidas (R$)</label>
            <input
              id="avail"
              className="input tabular text-lg font-semibold"
              inputMode="decimal"
              value={availableInput ?? centsToInput(defaultAvailable)}
              onChange={(e) => setAvailableInput(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="pill-action" onClick={() => setAvailableInput(centsToInput(defaultAvailable))}>
                Livre no mês: <Money cents={defaultAvailable} className="ml-1" />
              </button>
              {s && (
                <button type="button" className="pill-action" onClick={() => setAvailableInput(centsToInput(Math.max(0, Number(s.bank_balance_cents))))}>
                  Saldo bancário: <Money cents={s.bank_balance_cents} className="ml-1" />
                </button>
              )}
            </div>
          </div>
          <Toggle checked={allowPartial} onChange={setAllowPartial} label="Pagar parcialmente quando faltar" description="Aplica o que sobrar na próxima conta da fila." />
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-fg/10 pt-4 text-sm sm:grid-cols-5">
          <Stat label="Disponível" cents={sim.available} />
          <Stat label="Obrigações no plano" cents={sim.totalPlanned} />
          <Stat
            label={sim.shortfall > 0 ? 'Faltam' : 'Sobram'}
            cents={sim.shortfall > 0 ? sim.shortfall : sim.remaining}
            className={sim.shortfall > 0 ? 'text-expense' : 'text-income'}
          />
          <div>
            <p className="text-xs text-muted">Cobertas</p>
            <p className="text-lg font-semibold">{sim.rows.filter((r) => r.status === 'covered').length}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Ficam pendentes</p>
            <p className={`text-lg font-semibold ${sim.rows.some((r) => r.status === 'uncovered' || r.status === 'partial') ? 'text-expense' : ''}`}>
              {sim.rows.filter((r) => r.status === 'uncovered' || r.status === 'partial').length}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted">Simulação: nada é pago nem alterado até você confirmar um pagamento.</p>
      </section>

      {/* Modo */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="segmented grid w-full grid-cols-3 sm:inline-flex sm:w-auto" role="tablist" aria-label="Ordem">
          {(
            [
              ['manual', 'Minha ordem'],
              ['suggested', 'Sugestão'],
              ['ai', 'Assistente IA'],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button key={m} role="tab" aria-selected={mode === m} className={`chip ${mode === m ? 'chip-active' : ''}`} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'suggested' && suggestions.length > 1 && (
          <button className="btn-secondary btn-sm" onClick={() => setConfirmApply(suggestions.map((x) => x.debt.id))}>
            Usar esta ordem
          </button>
        )}
        {mode === 'ai' && aiOrder && aiOrder.order.length > 1 && (
          <button className="btn-secondary btn-sm" onClick={() => setConfirmApply(ordered.map((d) => d.id))}>
            Usar a ordem da IA
          </button>
        )}
      </div>

      {mode === 'suggested' && (
        <p className="text-sm text-muted">
          Ordem calculada por essencialidade, consequência do atraso, vencimento, juros, prioridade e capacidade de pagamento.
          Sua ordem manual não muda até você escolher “Usar esta ordem”.
        </p>
      )}
      {mode === 'ai' && <AdvisorPanel debts={active} available={parsedAvailable} onOrder={setAiOrder} order={aiOrder} />}

      {/* Lista */}
      {active.length === 0 ? (
        <EmptyState title="Nenhuma dívida em aberto.">Cadastre empréstimos, contas atrasadas e acordos para organizar a ordem de pagamento.</EmptyState>
      ) : mode === 'ai' && !aiOrder ? null : (
        <SortableList
          items={ordered}
          disabled={mode !== 'manual' || reorder.isPending}
          onReorder={saveOrder}
          renderItem={(d, index, handle, dragging) => (
            <DebtCard
              debt={d}
              position={index + 1}
              handle={handle}
              dragging={dragging}
              sim={simById.get(d.id)}
              plan={effectivePlan[d.id] ?? { choice: 'due' }}
              reasons={mode === 'suggested' ? suggestedReasons.get(d.id) : mode === 'ai' && aiReasons.get(d.id) ? [aiReasons.get(d.id)!] : undefined}
              manual={mode === 'manual'}
              canUp={index > 0}
              canDown={index < ordered.length - 1}
              onUp={() => move(index, -1)}
              onDown={() => move(index, 1)}
              onPlan={(item) => setChoice(d.id, item)}
              onPay={(cents) => setPaying({ debt: d, cents })}
              onOpen={() => setDetails(d)}
            />
          )}
        />
      )}

      {closed.length > 0 && (
        <div>
          <button className="link text-sm" onClick={() => setShowClosed((v) => !v)} aria-expanded={showClosed}>
            {showClosed ? 'Ocultar' : 'Mostrar'} quitadas e arquivadas ({closed.length})
          </button>
          {showClosed && (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {closed.map((d) => (
                <li key={d.id}>
                  <button className="card w-full text-left opacity-80 transition hover:opacity-100" onClick={() => setDetails(d)}>
                    <p className="font-semibold">{d.creditor_name}</p>
                    <p className="text-xs text-muted">
                      {d.debt_status === 'archived' ? 'Arquivada' : 'Quitada'} · pago <Money cents={d.balance.total_paid_cents} />
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <DebtForm open={form.open} debt={form.debt} onClose={() => setForm({ open: false })} />
      <PayDebtDialog debt={paying?.debt ?? null} suggestedCents={paying?.cents} onClose={() => setPaying(null)} />
      <ChargeDialog debt={charging} onClose={() => setCharging(null)} />
      <DebtDetails
        debt={details}
        onClose={() => setDetails(null)}
        onPay={(d) => { setDetails(null); setPaying({ debt: d }); }}
        onCharge={(d) => { setDetails(null); setCharging(d); }}
        onEdit={(d) => { setDetails(null); setForm({ open: true, debt: d }); }}
      />
      <ConfirmDialog
        open={!!confirmApply}
        title="Substituir sua ordem?"
        confirmLabel="Usar esta ordem"
        pending={reorder.isPending}
        message={<p>A ordem exibida passará a ser a sua ordem manual. Você pode reorganizar depois quando quiser.</p>}
        onClose={() => setConfirmApply(null)}
        onConfirm={() =>
          confirmApply &&
          reorder.mutate(confirmApply, {
            onSuccess: () => {
              toast('Ordem aplicada.');
              setConfirmApply(null);
              setMode('manual');
            },
            onError: (e) => toast(friendlyError(e), 'error'),
          })
        }
      />
    </div>
  );
}

function Stat({ label, cents, className = '' }: { label: string; cents: number; className?: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <Money cents={cents} className={`text-lg font-semibold ${className}`} />
    </div>
  );
}

function DebtCard({
  debt: d,
  position,
  handle,
  dragging,
  sim,
  plan,
  reasons,
  manual,
  canUp,
  canDown,
  onUp,
  onDown,
  onPlan,
  onPay,
  onOpen,
}: {
  debt: DebtView;
  position: number;
  handle: React.ReactNode;
  dragging: boolean;
  sim?: SimRow;
  plan: PlanItem;
  reasons?: string[];
  manual: boolean;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onPlan: (p: PlanItem) => void;
  onPay: (cents?: number) => void;
  onOpen: () => void;
}) {
  const [custom, setCustom] = useState(plan.customCents ? centsToInput(plan.customCents) : '');
  const badge = sim ? STATUS_BADGE[sim.status] : null;
  return (
    <article className={`card p-4 sm:p-5 ${dragging ? 'ring-2 ring-accent/60' : ''}`}>
      <div className="flex items-start gap-2 sm:gap-3">
        {handle}
        <span className="icon-bubble h-10 w-10 bg-sunset text-[#1e0f05]" aria-label={`Posição ${position}`}>
          {position}
        </span>
        <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <p className="truncate font-semibold">{d.creditor_name}</p>
          <p className="truncate text-xs text-muted">{d.description ?? CONSEQUENCE_LABEL[d.late_consequence]}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone={LEVEL_TONE[d.priority_level]}>{PRIORITY_LABEL[d.priority_level]}</Badge>
            {d.is_essential && <Badge tone="soft-ok">Essencial</Badge>}
            {d.daysOverdue !== null && <Badge tone="danger">Vencida há {d.daysOverdue}d</Badge>}
            {d.daysToDue !== null && d.daysToDue <= 7 && <Badge tone="warn">{d.daysToDue === 0 ? 'Vence hoje' : `Vence em ${d.daysToDue}d`}</Badge>}
            {d.interest_rate_monthly !== null && Number(d.interest_rate_monthly) > 0 && (
              <Badge>{Number(d.interest_rate_monthly).toLocaleString('pt-BR')}% a.m.</Badge>
            )}
          </div>
        </button>
        <div className="shrink-0 text-right">
          <Money cents={d.outstanding} className="block font-semibold" />
          <p className="text-[11px] text-muted">{d.next_due_date ? `vence ${formatDate(d.next_due_date)}` : 'sem vencimento'}</p>
        </div>
      </div>

      {reasons && reasons.length > 0 && (
        <p className="mt-3 flex gap-2 rounded-xl bg-accent/10 px-3 py-2 text-xs">
          <span className="font-semibold text-accent">Por quê:</span>
          <span>{reasons.join(' · ')}</span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-fg/10 pt-3">
        <select
          className="input h-9 w-auto rounded-full py-0 text-xs"
          aria-label="Quanto pagar na simulação"
          value={plan.choice}
          onChange={(e) => onPlan({ choice: e.target.value as PlanChoice, customCents: plan.customCents })}
        >
          {(Object.keys(PLAN_LABEL) as PlanChoice[]).map((c) => (
            <option key={c} value={c}>{PLAN_LABEL[c]}</option>
          ))}
        </select>
        {plan.choice === 'custom' && (
          <input
            className="input h-9 w-28 rounded-full text-xs tabular"
            inputMode="decimal"
            aria-label="Valor da simulação"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              onPlan({ choice: 'custom', customCents: parseMoneyToCents(e.target.value) ?? 0 });
            }}
          />
        )}
        {sim && sim.planned > 0 && <Money cents={sim.planned} className="text-sm font-semibold" />}
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
        {sim && sim.status !== 'skipped' && (
          <span className="text-xs text-muted">
            sobra depois: <Money cents={sim.balanceAfter} className={sim.balanceAfter === 0 ? 'text-expense' : ''} />
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {manual && (
            <>
              <button className="btn-ghost h-8 w-8 px-0" aria-label={`Subir ${d.creditor_name}`} disabled={!canUp} onClick={onUp}>
                <IconUp width={16} height={16} />
              </button>
              <button className="btn-ghost h-8 w-8 px-0" aria-label={`Descer ${d.creditor_name}`} disabled={!canDown} onClick={onDown}>
                <IconDown width={16} height={16} />
              </button>
            </>
          )}
          <button className="pill-action" onClick={() => onPay(sim && sim.paid > 0 ? sim.paid : undefined)}>
            Pagar
          </button>
        </span>
      </div>
      {d.daysOverdue !== null && d.late_consequence !== 'none' && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-expense">
          <IconAlert width={13} height={13} /> Em atraso: risco de {CONSEQUENCE_LABEL[d.late_consequence].toLowerCase()}.
        </p>
      )}
    </article>
  );
}
