/**
 * Export ZIP Helpers
 *
 * Turns a path → text-content map (as built by AccountExportFiles.ts and
 * ShapesExportFiles.ts) into a ZIP archive's raw bytes, and sanitizes
 * user-controlled text into filename-safe stems.
 */

import { zipSync, strToU8 } from 'fflate';

export function zipTextFiles(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const zipEntries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    zipEntries[path] = strToU8(content);
  }
  return zipSync(zipEntries);
}

/**
 * Filename stem from user-controlled text (persona names, slugs).
 *
 * The archive filenames in AccountExportJob and ShapesExportJob, and every
 * per-entity stem inside the account export's file map (`AccountExportFiles.ts`),
 * go through it, so one rule names every export path.
 */
export function sanitizeFileStem(stem: string): string {
  const sanitized = stem.replace(/[^\w.-]/g, '_');
  return sanitized === '' ? 'unnamed' : sanitized;
}
