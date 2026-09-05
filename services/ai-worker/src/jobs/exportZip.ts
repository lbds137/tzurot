/**
 * Export ZIP Helper
 *
 * Turns a path → text-content map (as built by AccountExportFiles.ts and
 * ShapesExportFiles.ts) into a ZIP archive's raw bytes.
 */

import { zipSync, strToU8 } from 'fflate';

export function zipTextFiles(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const zipEntries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    zipEntries[path] = strToU8(content);
  }
  return zipSync(zipEntries);
}
