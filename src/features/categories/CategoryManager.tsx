import { useEffect, useState } from 'react';
import { Badge, ConfirmDialog, Field, FormError, Modal, Toggle, useToast } from '@/components/ui';
import { IconDown, IconUp } from '@/components/icons';
import { useCategories, useDeleteCategory, useSaveCategory, useSwapCategoryOrder } from '@/hooks/data';
import { friendlyError } from '@/lib/errors';
import { newId } from '@/lib/id';
import type { Category, CategoryType } from '@/lib/types';

const TYPE_LABEL: Record<CategoryType, string> = { expense: 'Despesa', income: 'Receita', both: 'Ambos' };

export function CategoryManager() {
  const { data: categories = [] } = useCategories();
  const swap = useSwapCategoryOrder();
  const save = useSaveCategory();
  const del = useDeleteCategory();
  const toast = useToast();
  const [editing, setEditing] = useState<{ open: boolean; category?: Category; parentId?: string }>({ open: false });
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const visible = categories.filter((c) => showInactive || c.is_active);
  const roots = visible.filter((c) => !c.parent_id);

  const move = (list: Category[], idx: number, dir: -1 | 1) => {
    const other = list[idx + dir];
    if (!other) return;
    swap.mutate({ a: list[idx], b: other }, { onError: (e) => toast(friendlyError(e), 'error') });
  };

  const toggleActive = (c: Category) =>
    save.mutate(
      { id: c.id, existing: c, input: { is_active: !c.is_active } },
      {
        onSuccess: () => toast(c.is_active ? 'Categoria desativada.' : 'Categoria reativada.'),
        onError: (e) => toast(friendlyError(e), 'error'),
      },
    );

  const row = (c: Category, list: Category[], idx: number, child = false) => (
    <li key={c.id} className={`flex items-center gap-2 py-2.5 ${child ? 'pl-7' : ''} ${c.is_active ? '' : 'opacity-60'}`}>
      <span className="dot h-2.5 w-2.5" style={{ background: c.color ?? 'rgb(var(--line))' }} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm">
        {child && '↳ '}
        {c.name}{' '}
        <span className="text-xs text-muted">· {TYPE_LABEL[c.category_type]}</span>
        {c.is_essential && <span className="ml-1"><Badge>Essencial</Badge></span>}
        {!c.is_active && <span className="ml-1"><Badge>Desativada</Badge></span>}
      </span>
      <button className="btn-ghost p-1" aria-label={`Subir ${c.name}`} disabled={idx === 0 || swap.isPending} onClick={() => move(list, idx, -1)}>
        <IconUp width={16} height={16} />
      </button>
      <button className="btn-ghost p-1" aria-label={`Descer ${c.name}`} disabled={idx === list.length - 1 || swap.isPending} onClick={() => move(list, idx, 1)}>
        <IconDown width={16} height={16} />
      </button>
      <details className="relative">
        <summary className="btn-ghost cursor-pointer list-none px-2 py-1 text-xs">Ações</summary>
        <div className="absolute right-0 z-10 mt-1 flex w-48 flex-col rounded-xl border border-line bg-surface p-1 shadow-2xl">
          <button className="rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => setEditing({ open: true, category: c })}>Editar</button>
          {!child && (
            <button className="rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => setEditing({ open: true, parentId: c.id })}>Nova subcategoria</button>
          )}
          <button className="rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => toggleActive(c)}>{c.is_active ? 'Desativar' : 'Reativar'}</button>
          <button className="rounded px-3 py-1.5 text-left text-sm text-expense hover:bg-surface-2" onClick={() => { del.reset(); setDeleting(c); }}>Excluir</button>
        </div>
      </details>
    </li>
  );

  return (
    <section className="card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">Categorias</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar desativadas
          </label>
          <button className="btn-secondary btn-sm" onClick={() => setEditing({ open: true })}>+ Categoria</button>
        </div>
      </div>
      <p className="mb-2 text-xs text-muted">
        Categorias em uso não podem ser excluídas — desative-as para preservar o histórico. “Essencial” ajudará a sugerir a
        ordem de pagamento (Fase 2).
      </p>
      <ul className="divide-y divide-line/60">
        {roots.flatMap((r, i) => {
          const children = visible.filter((c) => c.parent_id === r.id);
          return [row(r, roots, i), ...children.map((c, j) => row(c, children, j, true))];
        })}
      </ul>

      <CategoryForm
        open={editing.open}
        category={editing.category}
        parentId={editing.parentId}
        roots={categories.filter((c) => !c.parent_id)}
        nextOrder={Math.max(0, ...categories.map((c) => c.sort_order)) + 10}
        onClose={() => setEditing({ open: false })}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Excluir categoria"
        danger
        confirmLabel="Excluir"
        pending={del.isPending}
        error={del.error ? friendlyError(del.error) : null}
        message={<p>Excluir <strong>{deleting?.name}</strong>? Se houver lançamentos, a exclusão será recusada; nesse caso, desative-a.</p>}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id, { onSuccess: () => { toast('Categoria excluída.'); setDeleting(null); } })}
      />
    </section>
  );
}

function CategoryForm({
  open,
  onClose,
  category,
  parentId,
  roots,
  nextOrder,
}: {
  open: boolean;
  onClose: () => void;
  category?: Category;
  parentId?: string;
  roots: Category[];
  nextOrder: number;
}) {
  const save = useSaveCategory();
  const toast = useToast();
  const [id, setId] = useState(newId);
  const [form, setForm] = useState({ name: '', type: 'expense' as CategoryType, parent: '', color: '#9ca3af', essential: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setId(category?.id ?? newId());
    setError(null);
    save.reset();
    const parent = roots.find((r) => r.id === (category?.parent_id ?? parentId));
    setForm({
      name: category?.name ?? '',
      type: category?.category_type ?? parent?.category_type ?? 'expense',
      parent: category?.parent_id ?? parentId ?? '',
      color: category?.color ?? parent?.color ?? '#9ca3af',
      essential: category?.is_essential ?? parent?.is_essential ?? false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError('Informe o nome.');
    setError(null);
    save.mutate(
      {
        id,
        existing: category,
        input: {
          name: form.name.trim(),
          category_type: form.type,
          parent_id: form.parent || null,
          color: form.color,
          is_essential: form.essential,
          ...(category ? {} : { is_active: true, sort_order: nextOrder }),
        },
      },
      { onSuccess: () => { toast('Categoria salva.'); onClose(); } },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={category ? 'Editar categoria' : 'Nova categoria'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={save.isPending}>Cancelar</button>
          <button type="submit" form="cat-form" className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <form id="cat-form" onSubmit={submit} noValidate className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <FormError message={error ?? (save.error ? friendlyError(save.error) : null)} />
        </div>
        <Field label="Nome" htmlFor="cat-name" className="col-span-2">
          <input id="cat-name" className="input" maxLength={60} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Tipo" htmlFor="cat-type">
          <select id="cat-type" className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CategoryType })}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Categoria principal" htmlFor="cat-parent">
          <select id="cat-parent" className="input" value={form.parent} onChange={(e) => setForm({ ...form, parent: e.target.value })}>
            <option value="">Nenhuma (principal)</option>
            {roots.filter((r) => r.id !== category?.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Cor" htmlFor="cat-color">
          <input id="cat-color" type="color" className="h-10 w-16 rounded border border-line bg-surface-2" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <Toggle checked={form.essential} onChange={(v) => setForm({ ...form, essential: v })} label="Essencial" />
        </div>
      </form>
    </Modal>
  );
}
