/**
 * Voice Reference Audit
 *
 * Audits all Personality voice reference uploads for duration compliance
 * against the BYOK Mistral TTS 30s reference-audio cap.
 *
 * Any reference >30s causes Mistral cloning to fail with a 400
 * "Reference audio duration X exceeds the maximum allowed duration of
 * 30.0s" error. The TtsDispatcher silently falls through to self-hosted
 * voice-engine, so the operator never sees the downgrade unless they
 * dig into ai-worker logs. This command surfaces all out-of-bounds
 * references in one report so they can be re-trimmed.
 *
 * Approach: read voiceReferenceData bytes directly from the DB, write
 * each to a temp file, and ffprobe against the file. The DB read avoids
 * an api-gateway round-trip. Temp files (vs stdin pipes) are needed
 * because ffprobe doesn't reliably auto-detect mp3 from pipe:0 without
 * a `-f` hint, and we want format-agnostic probing.
 */

import { spawn } from 'node:child_process';
import { writeFile, unlink, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import { DB_POOL_DEFAULTS } from '@tzurot/common-types/services/poolConfig';
import { createPrismaClient } from '@tzurot/common-types/services/prisma';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  getRailwayDatabaseUrl,
} from '../utils/env-runner.js';

/** Mistral Voxtral TTS hard limit on reference audio duration. */
export const MISTRAL_REF_CAP_S = 30.0;

/** Safety margin to flag refs near the cap that could trip on encoding rounding. */
export const NEAR_CAP_MARGIN_S = 0.5;

/** Bounded query limit per 03-database.md; caps runtime growth and emits a
 * truncation warning if the personality count hits the limit. Raise if the
 * count approaches this. */
const TAKE_LIMIT = 500;

export type DurationClassification = 'ok' | 'near_cap' | 'over' | 'errored';

/**
 * Bucket a probed reference into severity classes against the Mistral cap.
 * Exported for tests + reuse if a future caller wants the classification
 * without the full audit pipeline.
 */
export function classifyDuration(duration: number | null): DurationClassification {
  if (duration === null) return 'errored';
  if (duration > MISTRAL_REF_CAP_S) return 'over';
  if (duration > MISTRAL_REF_CAP_S - NEAR_CAP_MARGIN_S) return 'near_cap';
  return 'ok';
}

export interface AuditReferencesOptions {
  env?: Environment;
  /** Output as JSON instead of a human-readable table. Useful for piping. */
  json?: boolean;
}

interface RefRow {
  slug: string;
  name: string | null;
  type: string | null;
  sizeBytes: number;
  durationS: number | null;
  durationError?: string;
}

/**
 * Probe an audio file's duration via ffprobe by spawning against a real path.
 * Stdin-piped probing was attempted first but mp3 streams need format-detection
 * passes that don't reliably work on `pipe:0` without explicit `-f` hints, so
 * we write to a temp file and let ffprobe auto-detect normally.
 */
async function probeDurationFromPath(
  path: string
): Promise<{ duration: number | null; error?: string }> {
  return new Promise(resolve => {
    const proc = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', err => {
      resolve({ duration: null, error: `ffprobe spawn failed: ${err.message}` });
    });
    proc.on('close', code => {
      if (code !== 0) {
        resolve({ duration: null, error: stderr.trim() || `ffprobe exit ${code}` });
        return;
      }
      const parsed = parseFloat(stdout.trim());
      if (Number.isNaN(parsed)) {
        resolve({ duration: null, error: `ffprobe output not numeric: ${stdout.trim()}` });
        return;
      }
      resolve({ duration: parsed });
    });
  });
}

/**
 * Probe a single audio buffer's duration. Writes to a temp file because
 * ffprobe stdin reads don't reliably auto-detect mp3 format.
 */
async function probeDuration(
  bytes: Buffer,
  tmpDir: string,
  index: number
): Promise<{ duration: number | null; error?: string }> {
  const tmpPath = join(tmpDir, `ref-${index}.bin`);
  try {
    await writeFile(tmpPath, bytes);
    return await probeDurationFromPath(tmpPath);
  } finally {
    await unlink(tmpPath).catch(() => {
      /* best-effort cleanup */
    });
  }
}

function colorForDuration(duration: number | null): (s: string) => string {
  switch (classifyDuration(duration)) {
    case 'errored':
      return chalk.gray;
    case 'over':
      return chalk.red.bold;
    case 'near_cap':
      return chalk.yellow;
    case 'ok':
      return chalk.green;
  }
}

function formatTable(rows: RefRow[]): string {
  const header = ['Slug', 'Name', 'Duration', 'Size'];
  const data = rows.map(r => [
    r.slug,
    r.name ?? '',
    r.durationS === null ? `ERR: ${r.durationError ?? 'unknown'}` : `${r.durationS.toFixed(2)}s`,
    `${(r.sizeBytes / 1024).toFixed(0)} KB`,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...data.map(row => (row[i] ?? '').length))
  );
  // ` │ ` is 3 chars between every pair of columns; the last column has no
  // trailing separator, so we subtract 3 from the sum to match the row width.
  const sep = '─'.repeat(widths.reduce((a, b) => a + b + 3, 0) - 3);

  const lines: string[] = [];
  lines.push(header.map((h, i) => chalk.bold(h.padEnd(widths[i] ?? 0))).join(' │ '));
  lines.push(sep);
  for (let i = 0; i < rows.length; i++) {
    const row = data[i];
    const ref = rows[i];
    if (row === undefined || ref === undefined) continue;
    const color = colorForDuration(ref.durationS);
    lines.push(row.map((c, j) => color(c.padEnd(widths[j] ?? 0))).join(' │ '));
  }
  return lines.join('\n');
}

export async function auditReferences(options: AuditReferencesOptions = {}): Promise<void> {
  const env = options.env ?? 'local';
  validateEnvironment(env);
  showEnvironmentBanner(env);

  if (env !== 'local') {
    const databaseUrl = getRailwayDatabaseUrl(env);
    process.env.DATABASE_URL = databaseUrl;
  }

  const { prisma, dispose } = createPrismaClient({ max: DB_POOL_DEFAULTS.TRANSIENT_MAX });
  const tmpDir = await mkdtemp(join(tmpdir(), 'voice-refs-audit-'));
  try {
    const rawRows = await prisma.personality.findMany({
      where: { voiceReferenceData: { not: null } },
      select: {
        slug: true,
        name: true,
        voiceReferenceType: true,
        voiceReferenceData: true,
      },
      take: TAKE_LIMIT,
    });

    if (!options.json) {
      console.log(chalk.bold(`\nProbing ${rawRows.length} references via ffprobe...\n`));
    }

    const rows: RefRow[] = [];
    let probeIndex = 0;
    for (const r of rawRows) {
      if (r.voiceReferenceData === null) continue;
      const result = await probeDuration(Buffer.from(r.voiceReferenceData), tmpDir, probeIndex++);
      rows.push({
        slug: r.slug,
        name: r.name,
        type: r.voiceReferenceType,
        sizeBytes: r.voiceReferenceData.length,
        durationS: result.duration,
        durationError: result.error,
      });
    }

    rows.sort((a, b) => (b.durationS ?? -1) - (a.durationS ?? -1));

    if (options.json === true) {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      console.log(formatTable(rows));

      const over = rows.filter(r => classifyDuration(r.durationS) === 'over');
      const nearCap = rows.filter(r => classifyDuration(r.durationS) === 'near_cap');
      const errored = rows.filter(r => classifyDuration(r.durationS) === 'errored');

      console.log();
      console.log(chalk.bold('Summary:'));
      console.log(`  Total references: ${rows.length}`);
      console.log(
        `  ${chalk.red.bold(`Over ${MISTRAL_REF_CAP_S}s cap`)}: ${over.length}` +
          (over.length > 0 ? chalk.red.bold(' ← silent fallback to self-hosted on every TTS') : '')
      );
      console.log(
        `  ${chalk.yellow(`Within ${NEAR_CAP_MARGIN_S}s of cap`)}: ${nearCap.length}` +
          (nearCap.length > 0 ? chalk.yellow(' ← could trip on encoding rounding') : '')
      );
      console.log(
        `  ${chalk.green('Comfortable margin')}: ${rows.length - over.length - nearCap.length - errored.length}`
      );
      if (errored.length > 0) {
        console.log(`  ${chalk.gray('Probe errored')}: ${errored.length}`);
      }
      if (rawRows.length === TAKE_LIMIT) {
        console.log(
          chalk.yellow(
            `\n⚠️  Result truncated at the ${TAKE_LIMIT}-row take limit. Raise TAKE_LIMIT if needed.`
          )
        );
      }
    }
  } finally {
    await dispose().catch(() => undefined);
    // rm with recursive+force handles the case where any per-probe unlink
    // silently failed and left a file behind (rmdir would fail in that case).
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {
      /* best-effort cleanup */
    });
  }
}
