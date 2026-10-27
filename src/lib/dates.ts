/** Datas de calendário são tratadas como strings ISO "AAAA-MM-DD", sem fuso. */

export type ISODate = string;

export function todayIn(timezone = 'America/Sao_Paulo', now = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function toUTC(d: ISODate): Date {
  return new Date(`${d}T00:00:00Z`);
}

function fromUTC(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  const dt = toUTC(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
}

export function addMonths(d: ISODate, n: number): ISODate {
  const dt = toUTC(d);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + n);
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, last));
  return fromUTC(dt);
}

export function startOfMonth(d: ISODate): ISODate {
  return `${d.slice(0, 7)}-01`;
}

export function endOfMonth(d: ISODate): ISODate {
  const dt = toUTC(startOfMonth(d));
  return fromUTC(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)));
}

/** Semana de segunda a domingo. */
export function startOfWeek(d: ISODate): ISODate {
  const dow = toUTC(d).getUTCDay(); // 0 = domingo
  return addDays(d, dow === 0 ? -6 : 1 - dow);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(a).getTime() - toUTC(b).getTime()) / 86_400_000);
}

export type PeriodKind = 'week' | 'month' | 'next_month' | 'custom';

export interface Period {
  kind: PeriodKind;
  start: ISODate;
  end: ISODate;
}

export function periodFor(kind: PeriodKind, today: ISODate, custom?: { start: ISODate; end: ISODate }): Period {
  switch (kind) {
    case 'week': {
      const start = startOfWeek(today);
      return { kind, start, end: addDays(start, 6) };
    }
    case 'month':
      return { kind, start: startOfMonth(today), end: endOfMonth(today) };
    case 'next_month': {
      const next = addMonths(startOfMonth(today), 1);
      return { kind, start: next, end: endOfMonth(next) };
    }
    case 'custom': {
      const start = custom?.start ?? today;
      const end = custom?.end && custom.end >= start ? custom.end : start;
      return { kind, start, end };
    }
  }
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_LONG = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function formatDate(d: ISODate | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

export function formatDayHeader(d: ISODate, today: ISODate): string {
  if (d === today) return 'Hoje';
  if (d === addDays(today, -1)) return 'Ontem';
  if (d === addDays(today, 1)) return 'Amanhã';
  const dt = toUTC(d);
  const label = `${WEEKDAYS[dt.getUTCDay()]}, ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
  return d.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${d.slice(0, 4)}`;
}

export function formatMonth(d: ISODate): string {
  const dt = toUTC(d);
  const m = MONTHS_LONG[dt.getUTCMonth()];
  return `${m[0].toUpperCase()}${m.slice(1)} de ${dt.getUTCFullYear()}`;
}

export function formatPeriod(p: Period): string {
  if (p.kind === 'month' || p.kind === 'next_month') return formatMonth(p.start);
  return `${formatDate(p.start)} a ${formatDate(p.end)}`;
}

export function isValidISODate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const dt = toUTC(d);
  return !Number.isNaN(dt.getTime()) && fromUTC(dt) === d;
}
