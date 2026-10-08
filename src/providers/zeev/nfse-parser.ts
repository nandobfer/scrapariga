/**
 * nfse-parser.ts — Extract the NFS-e number from a PDF.
 *
 * The Contabilizei NFS-e PDFs carry a real text layer, so the "Número da Nota"
 * field is readable without OCR. We shell out to `pdftotext` (poppler-utils),
 * which is present on the target Linux/WSL host.
 *
 * The pure parse step (`extractNotaNumberFromText`) is separated so it can be
 * unit-tested without touching the filesystem or spawning a process.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';

const execFileAsync = promisify(execFile);

const MAX_PDFTOTEXT_BUFFER = 16 * 1024 * 1024;

/** Matches "Número da Nota" (with or without accent) followed by the number. */
const NOTA_NUMBER_RE = /N[uú]mero da Nota[\s:]*(\d+)/i;

/**
 * Reads the full text layer of a PDF via `pdftotext -layout`.
 * Throws a friendly error if the binary is missing.
 */
export async function extractNfseText(pdfPath: string): Promise<string> {
  await fs.access(pdfPath);

  try {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', pdfPath, '-'], {
      maxBuffer: MAX_PDFTOTEXT_BUFFER,
    });
    return stdout;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        'pdftotext não encontrado. Instale o poppler-utils (ex.: sudo apt install poppler-utils).',
      );
    }
    throw new Error(
      `Falha ao ler o PDF "${pdfPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Extracts the NFS-e number from a PDF file on disk. */
export async function extractNotaNumber(pdfPath: string): Promise<string> {
  return extractNotaNumberFromText(await extractNfseText(pdfPath), pdfPath);
}

/**
 * Pure helper: finds the NFS-e number inside already-extracted PDF text.
 * @param text   Text extracted from the NFS-e PDF.
 * @param source Label used in the error message (usually the file path).
 */
export function extractNotaNumberFromText(text: string, source = 'NFS-e'): string {
  const match = text.match(NOTA_NUMBER_RE);
  if (!match) {
    throw new Error(`Não foi possível localizar o "Número da Nota" em ${source}`);
  }
  return match[1];
}
