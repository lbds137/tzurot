/**
 * Surface Inventory Commands
 *
 * Type-checked inventory of bot-client's discord.js API surface, with a
 * committed snapshot pair and a `--check` drift gate.
 */

import type { CAC } from 'cac';

export const SURFACE_FORMATS = ['terminal', 'json', 'markdown'] as const;

export type SurfaceFormat = (typeof SURFACE_FORMATS)[number];

/**
 * Validate the `--format` value up front so an invalid format fails before
 * the expensive analyzer import (ts-morph) ever loads.
 */
export function resolveFormat(
  raw: string | undefined
): { ok: true; format: SurfaceFormat } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, format: 'terminal' };
  const valid = SURFACE_FORMATS as readonly string[];
  if (valid.includes(raw)) {
    return { ok: true, format: raw as SurfaceFormat };
  }
  return {
    ok: false,
    message: `Error: Invalid format "${raw}". Must be one of: ${SURFACE_FORMATS.join(', ')}`,
  };
}

/**
 * `--check` compares the committed snapshot against a fresh run; `--write`
 * regenerates it. Running both would write the file the check is about to
 * compare, so the combination is rejected up front — before the expensive
 * analyzer import.
 */
export function resolveFlagConflict(options: {
  check?: boolean;
  write?: boolean;
}): { ok: true } | { ok: false; message: string } {
  if (options.check === true && options.write === true) {
    return {
      ok: false,
      message:
        'Error: --check and --write are mutually exclusive. --check compares the committed snapshot against a fresh run; --write regenerates it. Run one at a time.',
    };
  }
  return { ok: true };
}

export function registerSurfaceCommands(cli: CAC): void {
  cli
    .command('surface:inventory', 'Inventory bot-client discord.js API surface (type-checked)')
    .option('--format <fmt>', 'Output: terminal, json, markdown', { default: 'terminal' })
    .option('--write', 'Write the snapshot pair to docs/reference/conformance/')
    .option('--check', 'Exit non-zero when the committed snapshot pair has drifted')
    .example('pnpm ops surface:inventory')
    .example('pnpm ops surface:inventory --format markdown')
    .example('pnpm ops surface:inventory --write')
    .example('pnpm ops surface:inventory --check')
    .action(async (options: { format?: string; write?: boolean; check?: boolean }) => {
      const resolution = resolveFormat(options.format);
      if (!resolution.ok) {
        console.error(resolution.message);
        process.exitCode = 1;
        return;
      }
      const conflict = resolveFlagConflict(options);
      if (!conflict.ok) {
        console.error(conflict.message);
        process.exitCode = 1;
        return;
      }

      // Dynamic imports keep ts-morph out of CLI startup for every other
      // command — the analyzer's Program load is the expensive step here.
      const [
        { analyzeBotClient },
        {
          buildSnapshotJson,
          renderSnapshotMarkdown,
          evaluateCheck,
          writeSnapshotFiles,
          SNAPSHOT_JSON_PATH,
          SNAPSHOT_MD_PATH,
        },
        { renderTerminal, renderJson, renderMarkdownOutput },
      ] = await Promise.all([
        import('../surface/analyzer.js'),
        import('../surface/snapshot.js'),
        import('../surface/render.js'),
      ]);

      const inventory = await analyzeBotClient(process.cwd());

      if (options.check === true) {
        const result = evaluateCheck(process.cwd(), inventory.entries);
        if (result.ok) {
          console.log(
            `✓ discord.js surface snapshot is up to date (${inventory.entries.length} entries).`
          );
          return;
        }
        for (const path of result.drifted) console.error(path);
        console.error(result.hint);
        process.exitCode = 1;
        return;
      }

      if (options.write === true) {
        writeSnapshotFiles(
          process.cwd(),
          buildSnapshotJson(inventory.entries),
          renderSnapshotMarkdown(inventory.entries)
        );
        console.log(`Wrote ${SNAPSHOT_JSON_PATH}`);
        console.log(`Wrote ${SNAPSHOT_MD_PATH}`);
        console.log(
          `Snapshot: ${inventory.entries.length} entries across ${inventory.totalSites} sites.`
        );
        return;
      }

      const rendered =
        resolution.format === 'json'
          ? renderJson(inventory)
          : resolution.format === 'markdown'
            ? renderMarkdownOutput(inventory)
            : renderTerminal(inventory);
      console.log(rendered);
    });
}
