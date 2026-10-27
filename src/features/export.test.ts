import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './export';

describe('CSV', () => {
  it('escapa separadores e aspas', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
  });

  it('neutraliza fórmulas, mas preserva números negativos', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+55')).toBe("'+55");
    expect(csvCell('-10,50')).toBe('-10,50');
  });

  it('gera BOM e usa ponto e vírgula', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('﻿a;b\r\n1;x');
  });
});
