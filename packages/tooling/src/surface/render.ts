/**
 * Stdout renderers for the surface inventory. Pure string returns — the
 * command module decides whether to print, write, or check.
 */

import { buildSnapshotJson, renderSnapshotMarkdown } from './snapshot.js';
import { SURFACE_CATEGORIES, type SurfaceInventory } from './types.js';

/**
 * Terminal report: every category prints, including empty ones (an empty
 * category is a statement), followed by the unclassified detail block when
 * that bucket is non-empty, then totals and wall-clock time.
 */
export function renderTerminal(inv: SurfaceInventory): string {
  const lines: string[] = [];
  for (const category of SURFACE_CATEGORIES) {
    const inCategory = inv.entries.filter(entry => entry.category === category);
    const sites = inCategory.reduce((sum, entry) => sum + entry.count, 0);
    lines.push(`${category}: ${inCategory.length} entries / ${sites} sites`);
  }

  const unclassified = inv.entries.filter(entry => entry.category === 'unclassified');
  if (unclassified.length > 0) {
    lines.push('');
    lines.push('unclassified detail:');
    for (const entry of unclassified) {
      lines.push(`  ${entry.file} ${entry.symbol} ${entry.count}`);
    }
  }

  lines.push('');
  lines.push(
    `Total: ${inv.entries.length} entries across ${inv.totalSites} sites in ${Math.round(inv.elapsedMs)} ms.`
  );
  return `${lines.join('\n')}\n`;
}

/** Machine-readable form: the snapshot document plus elapsedMs at top level (NOT the snapshot form). */
export function renderJson(inv: SurfaceInventory): string {
  const doc = JSON.parse(buildSnapshotJson(inv.entries)) as Record<string, unknown>;
  doc.elapsedMs = inv.elapsedMs;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Markdown form — the snapshot markdown without touching any files. */
export function renderMarkdownOutput(inv: SurfaceInventory): string {
  return renderSnapshotMarkdown(inv.entries);
}
