/**
 * Valores monetários trafegam como centavos inteiros. Nada de ponto flutuante
 * em cálculos: a conversão de texto acontece por manipulação de dígitos.
 */

const MAX_CENTS = 100_000_000_000_000; // limite também imposto no banco

/**
 * Converte texto digitado ("1.234,56", "1234.5", "R$ 10") em centavos.
 * Retorna null para entradas inválidas.
 */
export function parseMoneyToCents(input: string): number | null {
  if (typeof input !== 'string') return null;
  let s = input.replace(/\s|R\$/gi, '').trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart: string;
  let fracPart = '';

  if (lastComma >= 0 && lastComma > lastDot) {
    // vírgula decimal (padrão brasileiro); pontos são milhares
    intPart = s.slice(0, lastComma).replace(/\./g, '');
    fracPart = s.slice(lastComma + 1);
    if (fracPart.includes(',')) return null;
  } else if (lastDot >= 0 && lastComma < 0) {
    // somente pontos: decimal se houver 1–2 dígitos no fim e um único ponto
    const parts = s.split('.');
    if (parts.length === 2 && parts[1].length <= 2) {
      intPart = parts[0];
      fracPart = parts[1];
    } else if (parts.slice(1).every((p) => p.length === 3)) {
      intPart = parts.join('');
    } else {
      return null;
    }
  } else if (lastDot > lastComma && lastComma >= 0) {
    // formato "1,234.56"
    intPart = s.slice(0, lastDot).replace(/,/g, '');
    fracPart = s.slice(lastDot + 1);
  } else {
    intPart = s;
  }

  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart) || fracPart.length > 2) return null;
  if (!intPart && !fracPart) return null;
  const cents = Number(intPart || '0') * 100 + Number((fracPart + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return negative ? -cents : cents;
}

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(currency: string) {
  let f = formatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', { style: 'currency', currency });
    formatters.set(currency, f);
  }
  return f;
}

/** Formata centavos como moeda (padrão BRL). Aceita string vinda de bigint. */
export function formatCents(cents: number | string | null | undefined, currency = 'BRL'): string {
  const n = typeof cents === 'string' ? Number(cents) : cents ?? 0;
  const negative = n < 0;
  const abs = Math.abs(n);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  // Monta o número a partir de partes inteiras para não depender de float.
  const text = formatter(currency).format(Number(`${whole}.${String(frac).padStart(2, '0')}`));
  return negative ? `-${text}` : text;
}

/** Centavos -> texto editável "1234,56". */
export function centsToInput(cents: number | string | null | undefined): string {
  if (cents === null || cents === undefined || cents === '') return '';
  const n = Number(cents);
  const abs = Math.abs(n);
  return `${n < 0 ? '-' : ''}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

export function toCents(v: number | string | null | undefined): number {
  return v === null || v === undefined ? 0 : Number(v);
}
