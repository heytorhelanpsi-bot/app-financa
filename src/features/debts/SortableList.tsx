import { useRef, useState, type ReactNode } from 'react';
import { moveItem } from './logic';

/**
 * Lista reordenável por arrastar (mouse e toque, via Pointer Events) com
 * alça dedicada. Os botões de subir/descer ficam a cargo de quem renderiza,
 * garantindo uma alternativa acessível ao arrastar.
 */
export function SortableList<T extends { id: string }>({
  items,
  disabled,
  onReorder,
  renderItem,
}: {
  items: T[];
  disabled?: boolean;
  onReorder: (ids: string[]) => void;
  renderItem: (item: T, index: number, handle: ReactNode, dragging: boolean) => ReactNode;
}) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLLIElement>());
  const startOrder = useRef<string[]>([]);

  const ids = order ?? items.map((i) => i.id);
  const byId = new Map(items.map((i) => [i.id, i]));
  const visible = ids.map((id) => byId.get(id)).filter((x): x is T => !!x);

  function onPointerDown(e: React.PointerEvent, id: string) {
    if (disabled) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startOrder.current = items.map((i) => i.id);
    setOrder(startOrder.current);
    setDragId(id);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragId || !order) return;
    const from = order.indexOf(dragId);
    let to = from;
    order.forEach((id, idx) => {
      const el = refs.current.get(id);
      if (!el || id === dragId) return;
      const r = el.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (idx > from && e.clientY > mid) to = Math.max(to, idx);
      if (idx < from && e.clientY < mid) to = Math.min(to, idx);
    });
    if (to !== from) setOrder(moveItem(order, from, to));
  }

  function onPointerUp() {
    if (!dragId) return;
    const final = order ?? [];
    setDragId(null);
    setOrder(null);
    if (final.join() !== startOrder.current.join()) onReorder(final);
  }

  return (
    <ul className="space-y-3" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {visible.map((item, index) => {
        const handle = disabled ? null : (
          <button
            type="button"
            className="flex h-10 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:text-fg active:cursor-grabbing"
            aria-label="Arrastar para reordenar"
            title="Arrastar para reordenar"
            onPointerDown={(e) => onPointerDown(e, item.id)}
          >
            <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" aria-hidden>
              {[3, 9, 15].flatMap((y) => [<circle key={`a${y}`} cx="3" cy={y} r="1.6" />, <circle key={`b${y}`} cx="9" cy={y} r="1.6" />])}
            </svg>
          </button>
        );
        return (
          <li
            key={item.id}
            ref={(el) => {
              if (el) refs.current.set(item.id, el);
              else refs.current.delete(item.id);
            }}
            className={`transition-transform duration-150 ${dragId === item.id ? 'relative z-10 scale-[1.02]' : ''}`}
          >
            {renderItem(item, index, handle, dragId === item.id)}
          </li>
        );
      })}
    </ul>
  );
}
