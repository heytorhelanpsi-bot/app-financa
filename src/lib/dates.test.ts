import { describe, expect, it } from 'vitest';
import { addDays, addMonths, endOfMonth, isValidISODate, periodFor, startOfWeek, todayIn } from './dates';

describe('datas', () => {
  it('calcula início da semana (segunda)', () => {
    expect(startOfWeek('2026-10-27')).toBe('2026-10-26'); // terça -> segunda
    expect(startOfWeek('2026-11-01')).toBe('2026-10-26'); // domingo
    expect(startOfWeek('2026-10-26')).toBe('2026-10-26');
  });

  it('fim do mês e meses curtos', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-01')).toBe('2028-02-29');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('períodos', () => {
    expect(periodFor('month', '2026-10-27')).toEqual({ kind: 'month', start: '2026-10-01', end: '2026-10-31' });
    expect(periodFor('next_month', '2026-12-15')).toEqual({ kind: 'next_month', start: '2027-01-01', end: '2027-01-31' });
    expect(periodFor('week', '2026-10-27')).toEqual({ kind: 'week', start: '2026-10-26', end: '2026-11-01' });
    expect(periodFor('custom', '2026-10-27', { start: '2026-10-10', end: '2026-10-01' }).end).toBe('2026-10-10');
  });

  it('hoje respeita o fuso do usuário', () => {
    const utcLate = new Date('2026-10-28T01:30:00Z'); // 22:30 em São Paulo
    expect(todayIn('America/Sao_Paulo', utcLate)).toBe('2026-10-27');
    expect(todayIn('UTC', utcLate)).toBe('2026-10-28');
  });

  it('valida datas ISO', () => {
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2028-02-29')).toBe(true);
    expect(isValidISODate('2026-13-01')).toBe(false);
  });
});
