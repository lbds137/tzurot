/**
 * Goldens mining: pull a stratified sample of a persona's REAL memories so
 * retrieval goldens can be built at the corpus scale where dense-retrieval
 * dilution actually bites.
 *
 * Outputs land in a GITIGNORED working dir (`reports/goldens-mining/`):
 *   - corpus-raw.json          — the sampled rows, UNANONYMIZED (never commit)
 *   - swap-map.proposed.json   — proposed entity→placeholder swaps for owner review
 *   - entity-report.md         — the human review surface (swap table + drop instructions)
 *
 * The corpus is LOCAL-ONLY by policy — every artifact containing memory
 * content stays gitignored, including the anonymized output of the separate
 * `memory:anonymize-goldens` step. Real samples showed the content is
 * sensitive beyond what entity swaps can launder (identifying narratives,
 * third-party accounts), so what gets committed is this miner (deterministic:
 * same DB state → same sample) and the query goldens, never the rows. The
 * owner's review of the entity report gates the LOCAL anonymized artifact.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  countBelowFloor,
  extractEntityCandidates,
  proposeSwapMap,
  type CorpusRawRow,
  type SwapMap,
} from './goldens-anonymize.js';
import { pickEvenlySpaced } from './sampling.js';

/** Metadata row used for stratification (content deliberately absent). */
export interface MemoryMetaRow {
  id: string;
  personalityId: string;
  createdAt: Date;
  contentChars: number;
}

/** Skip fragments: rows shorter than this add noise, not dilution pressure. */
export const MIN_CONTENT_CHARS = 200;

/** Time-order buckets per personality — old and new memories both survive sampling. */
export const STRATA_BUCKETS = 12;

export interface StratifyOptions {
  /** Target sample size across all personalities. */
  sampleSize: number;
  /** Personalities to include (rows outside them are dropped first). */
  personalityIds: string[];
}

/**
 * Deterministic stratified sample: per personality (proportional to its share
 * of the filtered corpus), rows are time-ordered, cut into equal-count
 * buckets, and picked at even spacing within each bucket. No RNG — the same
 * corpus always yields the same sample, so a re-mine is diffable.
 *
 * Quotas are enforced EXACTLY per personality (each personality's selection
 * never exceeds its proportional quota), so the final global cap only trims
 * the ±1-per-personality rounding slack — proportionality survives.
 */
export function stratifySample(rows: MemoryMetaRow[], options: StratifyOptions): string[] {
  const { sampleSize, personalityIds } = options;
  const eligible = rows.filter(
    row => row.contentChars >= MIN_CONTENT_CHARS && personalityIds.includes(row.personalityId)
  );
  if (eligible.length <= sampleSize) {
    return eligible.map(row => row.id);
  }

  const selected: string[] = [];
  for (const personalityId of personalityIds) {
    const pool = eligible
      .filter(row => row.personalityId === personalityId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (pool.length === 0) {
      continue;
    }
    const quota = Math.min(
      pool.length,
      Math.max(1, Math.round((pool.length / eligible.length) * sampleSize))
    );
    // Even-spaced pick across time buckets (shared with mine-conversation-goldens).
    selected.push(...pickEvenlySpaced(pool, quota, STRATA_BUCKETS).map(row => row.id));
  }
  return selected.slice(0, sampleSize);
}

export interface MineGoldensOptions {
  env: 'local' | 'dev' | 'prod';
  personaId: string;
  /** Optional explicit personality filter; default = top 2 by row count. */
  personalityIds?: string[];
  sampleSize?: number;
  outDir?: string;
}

const DEFAULT_SAMPLE_SIZE = 800;
const DEFAULT_OUT_DIR = 'reports/goldens-mining';

/** Rows the metadata query returns before Date coercion. */
interface RawMetaRow {
  id: string;
  personality_id: string;
  created_at: Date;
  content_chars: number;
}

interface RawContentRow {
  id: string;
  personality_id: string;
  created_at: Date;
  content: string;
  senders: string[];
}

export async function mineGoldens(options: MineGoldensOptions): Promise<void> {
  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;

  const { getPrismaForEnv } = await import('./prisma-env.js');
  const { prisma, disconnect } = await getPrismaForEnv(options.env);

  try {
    // Deliberately unbounded: stratification needs the persona's FULL
    // time-range metadata (4 scalar columns; ~19k rows ≈ trivial). The
    // persona_id scope is the bound. Chunked rows are deliberately INCLUDED:
    // chunks are the unit production retrieval actually ranks (sibling
    // expansion happens after), so a faithful eval corpus contains them.
    const meta = await prisma.$queryRaw<RawMetaRow[]>`
      SELECT id, personality_id, created_at, length(content)::int AS content_chars
      FROM memories
      WHERE persona_id = ${options.personaId}::uuid
        AND visibility = 'normal'
        AND type = 'memory'
    `;
    const metaRows: MemoryMetaRow[] = meta.map(row => ({
      id: row.id,
      personalityId: row.personality_id,
      createdAt: new Date(row.created_at),
      contentChars: row.content_chars,
    }));
    console.log(`Persona corpus: ${metaRows.length} normal memories`);

    const personalityIds = options.personalityIds ?? topPersonalities(metaRows, 2);
    console.log(`Sampling from personalities: ${personalityIds.join(', ')}`);

    const sampledIds = stratifySample(metaRows, { sampleSize, personalityIds });
    console.log(`Stratified sample: ${sampledIds.length} rows (target ${sampleSize})`);

    const contentRows = await prisma.$queryRaw<RawContentRow[]>`
      SELECT id, personality_id, created_at, content, senders
      FROM memories
      WHERE id = ANY(${sampledIds}::uuid[])
    `;
    const corpus: CorpusRawRow[] = contentRows
      .map(row => ({
        id: row.id,
        personalityId: row.personality_id,
        createdAt: new Date(row.created_at).toISOString(),
        content: row.content,
        senders: row.senders,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const candidates = extractEntityCandidates(corpus.map(row => row.content));
    const swapMap = proposeSwapMap(
      candidates,
      corpus.flatMap(row => row.senders)
    );
    const belowFloorCount = countBelowFloor(candidates);

    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'corpus-raw.json'), JSON.stringify(corpus, null, 2));
    writeFileSync(join(outDir, 'swap-map.proposed.json'), JSON.stringify(swapMap, null, 2));
    writeFileSync(
      join(outDir, 'entity-report.md'),
      buildEntityReport(corpus, swapMap, belowFloorCount)
    );

    console.log(`\nWrote ${corpus.length} rows to ${outDir}/`);
    console.log(
      'Next: review entity-report.md, then PROMOTE the edited map (cp swap-map.proposed.json swap-map.json)'
    );
    console.log('— the rename is the explicit accept step — and run memory:anonymize-goldens.');
  } finally {
    await disconnect();
  }
}

/** Top-N personalities by eligible row count. */
export function topPersonalities(rows: MemoryMetaRow[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.contentChars >= MIN_CONTENT_CHARS) {
      counts.set(row.personalityId, (counts.get(row.personalityId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => id);
}

/** The human review surface: swap table + how-to for keep/drop decisions. */
function buildEntityReport(
  corpus: CorpusRawRow[],
  swapMap: SwapMap,
  belowFloorCount: number
): string {
  const lines = [
    '# Goldens mining — entity review',
    '',
    `Sample: ${corpus.length} rows, ${corpus.reduce((n, r) => n + r.content.length, 0)} chars total.`,
    '',
    'Review `swap-map.proposed.json`:',
    '- Each entry maps a detected entity to a proposed placeholder.',
    '- Edit `to` for a better placeholder, or set `"action": "keep"` to leave it unswapped.',
    '- Add memory ids to the top-level `dropRows` array to EXCLUDE a row entirely',
    '  (the too-private escape hatch — dropping beats clever swapping).',
    '- Anything the detector missed: add a new `{ "from": ..., "to": ... }` entry by hand.',
    `- NOTE: ${belowFloorCount} below-floor candidates (mostly one-off capitalizations) are`,
    '  excluded from this table — one-off real-name mentions only surface via a direct',
    '  spot-check of `corpus-raw.json`.',
    '- When done: `cp swap-map.proposed.json swap-map.json` (the explicit accept step),',
    '  then `pnpm ops memory:anonymize-goldens`.',
    '',
    '## Detected entities (by frequency)',
    '',
    '| Entity | Count | Proposed placeholder |',
    '|---|---|---|',
    ...swapMap.swaps.map(swap => `| \`${swap.from}\` | ${swap.count} | \`${swap.to}\` |`),
    '',
    '## Row index (for drop decisions)',
    '',
    ...corpus.map(
      row =>
        `- \`${row.id}\` · ${row.createdAt.slice(0, 10)} · ${row.content.slice(0, 80).replaceAll('\n', ' ')}…`
    ),
    '',
  ];
  return lines.join('\n');
}
