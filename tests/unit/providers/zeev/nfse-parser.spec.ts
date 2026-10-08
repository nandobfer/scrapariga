/**
 * nfse-parser.spec.ts — Unit tests for NFS-e number extraction.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractNotaNumber,
  extractNotaNumberFromText,
} from '../../../../src/providers/zeev/nfse-parser.js';

describe('extractNotaNumberFromText', () => {
  it('parses the number after "Número da Nota" (layout mode, next line)', () => {
    const text = [
      'PREFEITURA MUNICIPAL DE CURITIBA',
      'NOTA FISCAL DE SERVIÇOS ELETRÔNICA - NFS-e',
      '                    Número da Nota',
      '                           19',
      'Data da emissão',
      '06/10/2026 10:56',
    ].join('\n');

    expect(extractNotaNumberFromText(text)).toBe('19');
  });

  it('accepts the accent-less variant and an inline colon', () => {
    expect(extractNotaNumberFromText('Numero da Nota: 1234')).toBe('1234');
  });

  it('throws a descriptive error when the field is absent', () => {
    expect(() => extractNotaNumberFromText('nada aqui', 'foo.pdf')).toThrow(/Número da Nota/);
  });
});

const EXAMPLE_PDF = path.resolve(process.cwd(), 'exemplo-nf.pdf');
const hasExample = fs.existsSync(EXAMPLE_PDF);

describe.skipIf(!hasExample)('extractNotaNumber (exemplo-nf.pdf)', () => {
  it('extracts "19" from the example NFS-e PDF', async () => {
    await expect(extractNotaNumber(EXAMPLE_PDF)).resolves.toBe('19');
  });
});
