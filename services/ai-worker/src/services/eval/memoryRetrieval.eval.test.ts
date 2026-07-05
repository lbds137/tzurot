/**
 * Memory retrieval evaluation runner (memory-architecture §3.9).
 *
 * NOT a CI gate — a measurement tool, run manually (`pnpm eval:memory`)
 * before/after each memory-architecture phase. It exercises the REAL
 * production retrieval stack: real local embeddings (@tzurot/embeddings),
 * the real PgvectorMemoryAdapter SQL, PGLite with pgvector.
 *
 * Two kinds of assertion per golden:
 * - expectAbsent: HARD invariants (deleted memories, cross-persona leaks) —
 *   these fail the run outright; they are correctness, not quality.
 * - expectRecall: quality measurements — per-golden recall@K is reported and
 *   written to eval-results.json for before/after phase comparison. The
 *   committed baseline (phase0-baseline.json) is the reference point; phase
 *   gates and the design's re-open triggers fire on these numbers.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { LocalEmbeddingService } from '@tzurot/embeddings';
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PgvectorMemoryAdapter } from '../PgvectorMemoryAdapter.js';

const here = dirname(fileURLToPath(import.meta.url));

interface GoldenSeed {
  text: string;
  visibility?: string;
  persona?: 'main' | 'other';
}

interface Golden {
  id: string;
  category: string;
  description: string;
  seed: GoldenSeed[];
  query: string;
  k: number;
  expectRecall: string[];
  expectAbsent: string[];
}

const { goldens } = JSON.parse(readFileSync(join(here, 'retrieval-goldens.json'), 'utf8')) as {
  goldens: Golden[];
};

const MAIN_USER = '00000000-0000-0000-0000-00000000e001';
const MAIN_PERSONA = '00000000-0000-0000-0000-00000000e002';
const OTHER_USER = '00000000-0000-0000-0000-00000000e003';
const OTHER_PERSONA = '00000000-0000-0000-0000-00000000e004';
const PERSONALITY = '00000000-0000-0000-0000-00000000e005';
const SYSTEM_PROMPT = '00000000-0000-0000-0000-00000000e006';

describe('memory retrieval eval (golden corpus)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;
  let adapter: PgvectorMemoryAdapter;
  let embeddings: LocalEmbeddingService;
  const results: Record<
    string,
    {
      category: string;
      recallAtK: number;
      isQualityGolden: boolean;
      matched: string[];
      missed: string[];
      k: number;
    }
  > = {};

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: MAIN_USER,
      personaId: MAIN_PERSONA,
      discordId: '900000000000000001',
      username: 'evaluser',
      personaName: 'Eval Persona',
      personaPreferredName: 'Eval',
      personaContent: 'The measuring persona',
    });
    await seedUserWithPersona(prisma, {
      userId: OTHER_USER,
      personaId: OTHER_PERSONA,
      discordId: '900000000000000002',
      username: 'otheruser',
      personaName: 'Other Persona',
      personaPreferredName: 'Other',
      personaContent: 'The isolation-check persona',
    });
    await prisma.$executeRaw`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES (${SYSTEM_PROMPT}::uuid, 'Eval Prompt', 'You are an eval bot.', NOW())
    `;
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, display_name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY}::uuid, 'EvalBot', 'Eval Bot', 'evalbot', ${SYSTEM_PROMPT}::uuid, 'Eval character', 'Precise', ${MAIN_USER}::uuid, NOW())
    `;

    // The REAL embedding model — measurements are meaningless on mocks.
    embeddings = new LocalEmbeddingService();
    const ready = await embeddings.initialize();
    if (!ready) {
      throw new Error('Local embedding model failed to initialize — eval cannot run');
    }
    adapter = new PgvectorMemoryAdapter(prisma, embeddings);
  });

  afterAll(async () => {
    // Persist the run for before/after phase comparison. Copy to
    // phase<N>-baseline.json (committed) when establishing a phase baseline.
    // meanRecallAtK averages QUALITY goldens only — integrity-only goldens
    // (expectAbsent with no expectRecall) would otherwise dilute the headline
    // number upward as the corpus accretes invariants. Note: a golden whose
    // invariant is VIOLATED fails the vitest run before recording a result, so
    // the design's ">20% golden failures" trigger reads vitest pass/fail, not
    // this file alone.
    const quality = Object.values(results).filter(r => r.isQualityGolden);
    const summary = {
      generatedForPhase: 'set-at-baseline-time',
      totals: {
        goldens: Object.keys(results).length,
        qualityGoldens: quality.length,
        integrityGoldens: Object.keys(results).length - quality.length,
        meanRecallAtK:
          quality.reduce((sum, r) => sum + r.recallAtK, 0) / Math.max(1, quality.length),
      },
      results,
    };
    writeFileSync(join(here, 'eval-results.json'), `${JSON.stringify(summary, null, 2)}\n`);

    console.log(`\n=== memory retrieval eval ===\n${JSON.stringify(summary.totals, null, 2)}`);
    await prisma.$disconnect();
    await pglite.close();
    // The embedding service spawns a real worker thread — without shutdown the
    // runner hangs after completion (same reason backfill-ltm.ts shuts it down).
    await embeddings.shutdown();
  });

  it.each(goldens.map(g => [g.id, g] as const))('%s', async (_id, golden) => {
    await prisma.$executeRawUnsafe('DELETE FROM memories');

    for (const seed of golden.seed) {
      await adapter.addMemory({
        text: seed.text,
        metadata: {
          personaId: seed.persona === 'other' ? OTHER_PERSONA : MAIN_PERSONA,
          personalityId: PERSONALITY,
          canonScope: 'personal',
          createdAt: Date.now(),
          summaryType: 'conversation',
          contextType: 'channel',
          messageIds: [],
        },
      });
      if (seed.visibility !== undefined) {
        // Fully parameterized; exact-content match so an accreted golden with
        // ambiguous text fails LOUDLY (affected must be exactly 1) instead of
        // silently marking the wrong rows. Note: chunked (very long) seeds
        // would store content per-chunk — such a golden must be reworked, and
        // this assertion is what surfaces that.
        const affected = await prisma.$executeRawUnsafe(
          `UPDATE memories SET visibility = $1 WHERE content = $2`,
          seed.visibility,
          seed.text
        );
        expect(affected, `${golden.id}: visibility tag must hit exactly one row`).toBe(1);
      }
    }

    const hits = await adapter.queryMemories(golden.query, {
      personaId: MAIN_PERSONA,
      personalityId: PERSONALITY,
      limit: golden.k,
      // Rank-based recall@K: threshold intentionally floor-level so the
      // measurement reflects RANKING quality, not the production cutoff.
      scoreThreshold: 0.01,
    });
    const contents = hits.map(h => h.pageContent).join('\n---\n');

    // Hard invariants — correctness, fail outright.
    for (const absent of golden.expectAbsent) {
      expect(contents, `${golden.id}: "${absent}" must never surface`).not.toContain(absent);
    }

    // Quality measurement — recorded per golden.
    const matched = golden.expectRecall.filter(m => contents.includes(m));
    const missed = golden.expectRecall.filter(m => !contents.includes(m));
    results[golden.id] = {
      category: golden.category,
      recallAtK: golden.expectRecall.length === 0 ? 1 : matched.length / golden.expectRecall.length,
      isQualityGolden: golden.expectRecall.length > 0,
      matched,
      missed,
      k: golden.k,
    };
  });
});
