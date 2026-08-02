/**
 * Prompt prefix-diff — the provider-cache debugger (doc-17).
 *
 * Provider prompt caching pays only on the longest byte-identical prefix
 * between consecutive requests. A silent cache miss ("hit rate looks low")
 * is undiagnosable from telemetry alone; this tool turns it into a named
 * event: it fetches consecutive diagnostic rows for a channel, finds the
 * first divergence offset between each pair's system prompts, and annotates
 * the offset with the prompt SECTION it landed in (from the section map the
 * prompt builder stores in the payload). "Divergence at S1 system_identity"
 * reads as "persona edit, expected"; "divergence at V context" reads as
 * "datetime — the volatile tier is still in the prefix".
 *
 * Fetching runs in a subprocess with the target env's DATABASE_URL injected
 * (the inspect/tts-configs pattern); all comparison/annotation logic is pure
 * and unit-tested here. Diagnostic rows live 24h — the tool diagnoses LIVE
 * cache behavior, not history.
 */

import chalk from 'chalk';
import { execFileSync } from 'node:child_process';

import { type Environment, getRailwayEnvName, resolveDatabaseUrl } from '../utils/env-runner.js';

/** Mirrors common-types' DiagnosticPromptSection (payload-borne, hence re-declared loosely). */
export interface PromptSectionEntry {
  id: string;
  tier: string;
  chars: number;
  offset: number;
}

/** One diagnostic row's prompt-relevant extract (subprocess output shape). */
export interface PromptRow {
  requestId: string;
  createdAt: string;
  model: string;
  systemPrompt: string;
  sections?: PromptSectionEntry[];
}

/** Comparison of one consecutive request pair's system prompts. */
export interface PrefixComparison {
  identical: boolean;
  /** Length of the shared byte-identical prefix. */
  commonPrefixChars: number;
  olderLength: number;
  newerLength: number;
}

/** Compare two system prompts for cache-prefix purposes. */
export function comparePrefixes(older: string, newer: string): PrefixComparison {
  const max = Math.min(older.length, newer.length);
  let i = 0;
  while (i < max && older.charCodeAt(i) === newer.charCodeAt(i)) {
    i++;
  }
  return {
    identical: older === newer,
    commonPrefixChars: i,
    olderLength: older.length,
    newerLength: newer.length,
  };
}

/**
 * Name the section an offset lands in. Offsets inside the separator between
 * two sections annotate as the boundary before the following section; offsets
 * past the last section report as past-end (one prompt is a prefix of the
 * other — growth, not mutation).
 *
 * Assumes `sections` is sorted ascending by offset — true by construction on
 * the producer side (the prompt builder's describeSections assigns offsets
 * sequentially), but worth knowing since the entries arrive payload-borne.
 */
export function sectionAtOffset(
  offset: number,
  sections: PromptSectionEntry[] | undefined
): string {
  if (sections === undefined || sections.length === 0) {
    return 'unknown (no section map on this row)';
  }
  for (const section of sections) {
    if (offset >= section.offset && offset < section.offset + section.chars) {
      return `${section.tier} ${section.id}`;
    }
    if (offset < section.offset) {
      return `boundary before ${section.tier} ${section.id}`;
    }
  }
  return 'past the last section';
}

/** Extract the system prompt + section map from a stored diagnostic payload. */
export function extractPromptRow(row: {
  requestId: string;
  createdAt: string | Date;
  model: string;
  data: unknown;
}): PromptRow | null {
  const payload = row.data as {
    assembledPrompt?: {
      messages?: { role?: string; content?: string }[];
      systemPromptSections?: PromptSectionEntry[];
    };
  } | null;
  const messages = payload?.assembledPrompt?.messages;
  const system = Array.isArray(messages)
    ? messages.find(message => message.role === 'system')
    : undefined;
  if (system?.content === undefined) {
    return null;
  }
  return {
    requestId: row.requestId,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString(),
    model: row.model,
    systemPrompt: system.content,
    sections: payload?.assembledPrompt?.systemPromptSections,
  };
}

/** One formatted line block per consecutive pair (oldest→newest order). */
export function buildPairReports(rows: PromptRow[]): string[] {
  const reports: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const older = rows[i - 1];
    const newer = rows[i];
    const cmp = comparePrefixes(older.systemPrompt, newer.systemPrompt);
    const header = `${older.requestId.slice(0, 8)} → ${newer.requestId.slice(0, 8)}  (${newer.createdAt}, ${newer.model})`;
    if (cmp.identical) {
      reports.push(`${header}\n  IDENTICAL (${cmp.newerLength} chars) — full prefix reusable`);
      continue;
    }
    const percent =
      cmp.newerLength > 0 ? Math.round((cmp.commonPrefixChars / cmp.newerLength) * 100) : 0;
    let where = sectionAtOffset(cmp.commonPrefixChars, newer.sections);
    if (where === 'past the last section') {
      // Offsets are annotated against the NEWER prompt's own section map, so
      // past-end can only mean the newer prompt ended where the older one
      // continued — a shrink (fewer memories, truncated history). A longer
      // newer prompt always lands inside its own sections. Anything else
      // reaching here means the stored map doesn't cover the message.
      where +=
        cmp.newerLength < cmp.olderLength
          ? ' — newer prompt is a truncated prefix of the older one (shrink)'
          : ' (offset beyond the stored section map — map may be stale)';
    }
    reports.push(
      `${header}\n` +
        `  common prefix ${cmp.commonPrefixChars}/${cmp.newerLength} chars (${percent}%)\n` +
        `  first divergence at offset ${cmp.commonPrefixChars}: ${where}`
    );
  }
  return reports;
}

/**
 * Extract the JSON payload from subprocess stdout. The child's ONLY console
 * output is one JSON array line, and its logger runs silenced — but any stray
 * future write must degrade to a diagnosable error, not a bare SyntaxError:
 * parse the LAST non-empty line (the payload prints last before exit) and
 * name the culprit line on failure.
 */
export function parsePayloadLine(stdout: string): {
  requestId: string;
  createdAt: string;
  model: string;
  data: unknown;
}[] {
  const lines = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  const payload = lines.at(-1);
  if (payload === undefined) {
    throw new Error('Subprocess produced no output — expected a JSON row array');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed)) {
    // Covers both unparseable text and parseable-but-wrong shapes (a stray
    // pino object line printing AFTER the payload).
    throw new Error(
      `Subprocess output was not a JSON row array. Last line: ${payload.slice(0, 200)}`
    );
  }
  return parsed as ReturnType<typeof parsePayloadLine>;
}

interface PrefixDiffOptions {
  env: Environment;
  channelId: string;
  personalityId?: string;
  limit: number;
}

/**
 * Build the inline tsx fetch script. It ONLY fetches and prints JSON — every
 * comparison decision lives in the pure functions above where tests reach it.
 * Filter values are validated (snowflake/UUID shapes) before interpolation.
 */
export function buildFetchScript(options: {
  channelId: string;
  personalityId?: string;
  rowLimit: number;
}): string {
  if (!/^\d{17,20}$/.test(options.channelId)) {
    throw new Error(`channelId must be a Discord snowflake, got: ${options.channelId}`);
  }
  if (
    options.personalityId !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.personalityId)
  ) {
    throw new Error(`personalityId must be a UUID, got: ${options.personalityId}`);
  }
  if (!Number.isInteger(options.rowLimit) || options.rowLimit < 1) {
    throw new Error(`rowLimit must be a positive integer, got: ${String(options.rowLimit)}`);
  }
  const personalityFilter =
    options.personalityId !== undefined ? `, personalityId: '${options.personalityId}'` : '';
  return `
import { createPrismaClient } from '@tzurot/common-types/services/prisma';
import { DB_POOL_DEFAULTS } from '@tzurot/common-types/services/poolConfig';

async function main() {
  const { prisma, dispose } = createPrismaClient({ max: DB_POOL_DEFAULTS.TRANSIENT_MAX });
  try {
    const rows = await prisma.llmDiagnosticLog.findMany({
      where: { channelId: '${options.channelId}'${personalityFilter} },
      select: { requestId: true, createdAt: true, model: true, data: true },
      orderBy: { createdAt: 'desc' },
      take: ${options.rowLimit},
    });
    console.log(JSON.stringify(rows));
  } finally {
    await dispose().catch(() => undefined);
  }
}

// No top-level await: tsx -e compiles the inline script as CJS, where
// top-level await is a hard esbuild error.
main().catch(error => {
  console.error(error);
  process.exit(1);
});
`.trim();
}

/** Run the prefix-diff against an environment's diagnostic store. */
export async function runPrefixDiff(options: PrefixDiffOptions): Promise<void> {
  const railwayLabel =
    options.env === 'local' ? 'LOCAL' : getRailwayEnvName(options.env).toUpperCase();
  console.log(
    chalk.cyan(`\n🧊 Prompt prefix-diff — ${railwayLabel}, channel ${options.channelId}`)
  );
  console.log(chalk.dim('────────────────────────────────────────\n'));

  const databaseUrl = resolveDatabaseUrl(options.env);
  // limit = pair count; +1 rows produce that many consecutive pairs.
  const script = buildFetchScript({
    channelId: options.channelId,
    personalityId: options.personalityId,
    rowLimit: options.limit + 1,
  });

  // LOG_LEVEL fatal: createPrismaClient logs pino NDJSON at info level to
  // stdout (pool init/connect/dispose lines) — the same fd the JSON payload
  // uses. 'fatal' is the quietest level the env schema accepts ('silent' is
  // valid pino but rejected by config validation, runtime-verified); any
  // stray line that still slips through is handled by the last-line parse.
  const stdout = execFileSync('tsx', ['-e', script], {
    env: { ...process.env, DATABASE_URL: databaseUrl, LOG_LEVEL: 'fatal' },
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });

  const rawRows = parsePayloadLine(stdout);
  const promptRows = rawRows
    .map(row => extractPromptRow(row))
    .filter((row): row is PromptRow => row !== null)
    // fetched newest-first; compare oldest→newest so "newer" is the cache probe
    .reverse();

  const skipped = rawRows.length - promptRows.length;
  if (skipped > 0) {
    console.log(
      chalk.yellow(`⚠️  ${skipped} row(s) had no assembled prompt (error paths) — skipped`)
    );
  }
  if (promptRows.length < 2) {
    console.log(
      chalk.yellow(
        `Need at least 2 rows with assembled prompts to diff; found ${promptRows.length}. ` +
          'Diagnostic rows live 24h — generate two turns in the channel and re-run.'
      )
    );
    return;
  }

  for (const report of buildPairReports(promptRows)) {
    console.log(report + '\n');
  }
  const withSections = promptRows.filter(row => (row.sections?.length ?? 0) > 0).length;
  if (withSections < promptRows.length) {
    console.log(
      chalk.dim(
        `${promptRows.length - withSections} row(s) predate the section map — offsets shown without annotation.`
      )
    );
  }
}
