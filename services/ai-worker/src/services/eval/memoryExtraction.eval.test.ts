/**
 * Extraction-precision eval (memory Phase 2 §3.9) — a MEASUREMENT, not a CI gate.
 *
 * Runs the REAL extraction prompt + REAL cheap model (costs money, needs the
 * system OpenRouter key in env) against the golden corpus, parses with the
 * production schema (fail-to-skip), and scores precision / recall /
 * hallucination-rate via embedding fact-equivalence. Invoked manually:
 * `pnpm eval:extraction`. Results land in extraction-eval-results.json; copy
 * to phase2-baseline.json when establishing the slice-2 baseline.
 *
 * Gate semantics (per the phase plan): slice 2 ships at >=80% mean precision;
 * slice 4 (retrieval integration) requires >=95% precision / <=5%
 * hallucination on the grown corpus.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LocalEmbeddingService } from '@tzurot/embeddings';
import {
  buildExtractionPrompt,
  extractionResponseSchema,
  extractJsonPayload,
} from '../extraction/extractionPrompt.js';
import { invokeExtractionModel } from '../extraction/FactExtractionService.js';
import { matchFacts } from './factEquivalence.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ExtractionGolden {
  id: string;
  category: string;
  isFiction?: boolean;
  episodes: string[];
  knownFacts: { statement: string; entityTags: string[] }[];
  expectFacts: string[];
  expectSupersedesKnownIndex: number[];
}

interface GoldenResult {
  category: string;
  precision: number;
  recall: number;
  extractedCount: number;
  hallucinations: string[];
  supersessionHit: boolean | null;
}

const { goldens } = JSON.parse(
  readFileSync(join(__dirname, 'extraction-goldens.json'), 'utf-8')
) as { goldens: ExtractionGolden[] };

let embeddings: LocalEmbeddingService;
const results: Record<string, GoldenResult> = {};

describe('memory extraction eval (real model — manual run only)', () => {
  beforeAll(async () => {
    embeddings = new LocalEmbeddingService();
    const ready = await embeddings.initialize();
    if (!ready) {
      throw new Error('Local embedding model failed to initialize — eval cannot run');
    }
  }, 180_000);

  afterAll(async () => {
    const scored = Object.values(results);
    const mean = (xs: number[]): number =>
      xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
    const allHallucinations = scored.flatMap(r => r.hallucinations);
    const totalExtracted = scored.reduce((a, r) => a + r.extractedCount, 0);
    const supersessionGoldens = scored.filter(r => r.supersessionHit !== null);
    const summary = {
      generatedForPhase: 'set-at-baseline-time',
      totals: {
        goldens: scored.length,
        meanPrecision: mean(scored.map(r => r.precision)),
        meanRecall: mean(scored.map(r => r.recall)),
        hallucinationRate: totalExtracted === 0 ? 0 : allHallucinations.length / totalExtracted,
        supersessionHitRate:
          supersessionGoldens.length === 0
            ? null
            : supersessionGoldens.filter(r => r.supersessionHit === true).length /
              supersessionGoldens.length,
      },
      results,
    };
    writeFileSync(
      join(__dirname, 'extraction-eval-results.json'),
      `${JSON.stringify(summary, null, 2)}\n`
    );
    await embeddings.shutdown();
  });

  it.each(goldens)(
    '$id ($category)',
    async golden => {
      const knownForContext = golden.knownFacts.map((f, i) => ({
        id: `known-${i}`,
        statement: f.statement,
        entityTags: f.entityTags,
        isLocked: false,
      }));
      const prompt = buildExtractionPrompt(
        golden.episodes,
        knownForContext,
        golden.isFiction === true
      );

      const raw = await invokeExtractionModel(prompt);
      const parsed = extractionResponseSchema.safeParse(JSON.parse(extractJsonPayload(raw)));
      // A schema-invalid response is a HARD failure: production would skip the
      // batch entirely, which for a golden means the extractor produced nothing
      // usable — that's a real quality signal, not harness noise.
      expect(parsed.success, `schema-invalid response for ${golden.id}`).toBe(true);
      if (!parsed.success) {
        return;
      }

      const extractedStatements = parsed.data.facts.map(f => f.statement);
      const match = await matchFacts(extractedStatements, golden.expectFacts, embeddings);

      // Supersession scoring: did any extracted fact name each expected index?
      let supersessionHit: boolean | null = null;
      if (golden.expectSupersedesKnownIndex.length > 0) {
        const namedIndexes = new Set(
          parsed.data.facts.map(f => f.supersedesIndex).filter(i => i !== null)
        );
        supersessionHit = golden.expectSupersedesKnownIndex.every(i => namedIndexes.has(i));
      }

      results[golden.id] = {
        category: golden.category,
        precision: match.precision,
        recall: match.recall,
        extractedCount: extractedStatements.length,
        hallucinations: match.unmatchedExtracted,
        supersessionHit,
      };

      // Per-golden measurements are recorded, not asserted — the corpus-level
      // means in the results file drive the phase gates. The only hard per-golden
      // invariant is schema validity (above).
    },
    120_000
  );
});
