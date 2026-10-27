import { describe, expect, it } from 'vitest';
import { centsToInput, formatCents, parseMoneyToCents } from './money';

describe('parseMoneyToCents', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['1234,5', 123450],
    ['0,01', 1],
    ['R$ 4.000', 400000],
    ['4.000,00', 400000],
    ['500', 50000],
    ['12.5', 1250],
    ['1,234.56', 123456],
    ['1.234.567', 123456700],
    ['-10,00', -1000],
    [',99', 99],
  ])('%s -> %i', (input, expected) => {
    expect(parseMoneyToCents(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,2,3', '1,234', '10,999', '1.2.3', '--1', '1e5'])('rejeita %s', (input) => {
    expect(parseMoneyToCents(input)).toBeNull();
  });

  it('não sofre erro de ponto flutuante', () => {
    expect(parseMoneyToCents('0,10')! + parseMoneyToCents('0,20')!).toBe(30);
    expect(parseMoneyToCents('19,99')).toBe(1999);
    expect(parseMoneyToCents('1.000.000,07')).toBe(100000007);
  });
});

describe('formatCents', () => {
  it('formata em reais', () => {
    expect(formatCents(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
    expect(formatCents(-50).replace(/\s/g, ' ')).toBe('-R$ 0,50');
    expect(formatCents('350000').replace(/\s/g, ' ')).toBe('R$ 3.500,00');
  });

  it('ida e volta com o campo editável', () => {
    expect(centsToInput(123456)).toBe('1234,56');
    expect(parseMoneyToCents(centsToInput(5))).toBe(5);
    expect(centsToInput(-1000)).toBe('-10,00');
  });
});
