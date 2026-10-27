import { useId, useMemo, useRef, useState } from 'react';
import { formatCents } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import type { ProjectionPoint } from '@/lib/types';

const W = 640;
const H = 180;
const PAD = { top: 16, right: 12, bottom: 22, left: 12 };

/**
 * Área de série única (saldo projetado por dia) com linha de zero, ponto mínimo
 * destacado, cruz + dica ao passar o dedo/mouse e tabela acessível.
 */
export function ProjectionChart({ points }: { points: ProjectionPoint[] }) {
  const gid = useId().replace(/:/g, '');
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const values = points.map((p) => Number(p.balance_cents));
    const min = Math.min(0, ...values);
    const max = Math.max(...values, 0);
    const span = max - min || 1;
    const x = (i: number) => PAD.left + (i / Math.max(1, points.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom);
    const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(values.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
    const minIdx = values.indexOf(Math.min(...values));
    return { values, x, y, line, area, minIdx, hasNegative: min < 0 };
  }, [points]);

  if (points.length < 2) return null;

  function onMove(e: React.PointerEvent) {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const rel = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((rel - PAD.left) / (W - PAD.left - PAD.right)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  const h = hover !== null ? points[hover] : null;
  const last = points.length - 1;

  return (
    <div className="relative" ref={wrap} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full touch-pan-y" role="img" aria-label="Saldo projetado por dia">
        <defs>
          <linearGradient id={`area-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgb(var(--sun-2))" stopOpacity="0.35" />
            <stop offset="1" stopColor="rgb(var(--sun-2))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* linha de zero */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={geo.y(0)}
          y2={geo.y(0)}
          stroke={geo.hasNegative ? 'rgb(var(--expense))' : 'rgb(var(--fg) / 0.15)'}
          strokeDasharray="4 4"
          strokeWidth="1"
        />
        <path d={geo.area} fill={`url(#area-${gid})`} />
        <path d={geo.line} fill="none" stroke="rgb(var(--sun-2))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* menor saldo */}
        <circle
          cx={geo.x(geo.minIdx)}
          cy={geo.y(geo.values[geo.minIdx])}
          r="4.5"
          fill={geo.values[geo.minIdx] < 0 ? 'rgb(var(--expense))' : 'rgb(var(--sun-3))'}
          stroke="rgb(var(--surface))"
          strokeWidth="2"
        />
        {hover !== null && (
          <g>
            <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="rgb(var(--fg) / 0.3)" strokeWidth="1" />
            <circle cx={geo.x(hover)} cy={geo.y(geo.values[hover])} r="5" fill="rgb(var(--sun-2))" stroke="rgb(var(--surface))" strokeWidth="2" />
          </g>
        )}
        <text x={PAD.left} y={H - 4} fontSize="11" fill="rgb(var(--muted))">{formatDate(points[0].day).slice(0, 5)}</text>
        <text x={W - PAD.right} y={H - 4} fontSize="11" fill="rgb(var(--muted))" textAnchor="end">
          {formatDate(points[last].day).slice(0, 5)}
        </text>
      </svg>
      {h && hover !== null && (
        <div
          className="glass pointer-events-none absolute top-0 z-10 rounded-2xl px-3 py-2 text-xs"
          style={{ left: `${Math.min(70, Math.max(0, (geo.x(hover) / W) * 100 - 15))}%` }}
        >
          <p className="font-semibold">{formatDate(h.day)}</p>
          <p className="tabular">Saldo: <strong className={Number(h.balance_cents) < 0 ? 'text-expense' : ''}>{formatCents(h.balance_cents)}</strong></p>
          {Number(h.inflow_cents) > 0 && <p className="tabular text-income">Entra: {formatCents(h.inflow_cents)}</p>}
          {Number(h.outflow_cents) > 0 && <p className="tabular text-expense">Sai: {formatCents(h.outflow_cents)}</p>}
        </div>
      )}
      <table className="sr-only">
        <caption>Saldo projetado por dia</caption>
        <thead>
          <tr><th>Dia</th><th>Entradas</th><th>Saídas</th><th>Saldo</th></tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}>
              <td>{formatDate(p.day)}</td>
              <td>{formatCents(p.inflow_cents)}</td>
              <td>{formatCents(p.outflow_cents)}</td>
              <td>{formatCents(p.balance_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
