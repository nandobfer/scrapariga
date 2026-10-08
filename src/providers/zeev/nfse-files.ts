/**
 * nfse-files.ts — Locate the NFS-e and CND PDFs on disk.
 *
 * Conventions:
 *   - NFS-e: `documents/nfse/*.pdf` (newest of the current month).
 *   - CND:   `documents/cnd/*.pdf` or the CndProvider output directory
 *            `documents/certidao-negativa-debitos/*.pdf` (newest overall).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export const NFSE_DIR = path.resolve(process.cwd(), 'documents', 'nfse');
export const CND_DIR = path.resolve(process.cwd(), 'documents', 'cnd');
/** Default output directory used by CndProvider.buildFilePath(). */
export const CND_PROVIDER_DIR = path.resolve(
  process.cwd(),
  'documents',
  'certidao-negativa-debitos',
);

interface PdfEntry {
  filePath: string;
  mtimeMs: number;
}

async function listPdfs(dirs: string[]): Promise<PdfEntry[]> {
  const entries: PdfEntry[] = [];

  for (const dir of dirs) {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue; // directory does not exist / not readable
    }

    for (const name of names) {
      if (!name.toLowerCase().endsWith('.pdf')) continue;
      const filePath = path.join(dir, name);
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile()) entries.push({ filePath, mtimeMs: stat.mtimeMs });
      } catch {
        // skip unreadable entry
      }
    }
  }

  return entries;
}

/**
 * Returns the newest NFS-e PDF modified in the current month, or undefined.
 * @param now Reference date (defaults to today) — injectable for tests.
 */
export async function resolveLatestNfsePdf(now: Date = new Date()): Promise<string | undefined> {
  const entries = await listPdfs([NFSE_DIR]);

  const sameMonth = entries.filter((e) => {
    const d = new Date(e.mtimeMs);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  sameMonth.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sameMonth[0]?.filePath;
}

/** Returns the newest CND PDF across both known directories, or undefined. */
export async function resolveLatestCndPdf(): Promise<string | undefined> {
  const entries = await listPdfs([CND_DIR, CND_PROVIDER_DIR]);
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries[0]?.filePath;
}
