/**
 * Extraction-precision eval (memory Phase 2 §3.9) — a MEASUREMENT, not a CI gate.
 *
 * Runs the REAL extraction prompt + REAL cheap model (costs money, needs the
 * system OpenRouter key in env) against the golden corpus, parses with the
 * production schema (fail-to-skip), and scores recall / violation-rate via
 * source-grounded embedding fact-equivalence (methodology v2 — see
 * `scoreExtraction`). Invoked manually: `pnpm eval:extraction`. Results land
 * in extraction-eval-results.json; copy to phase2-extraction-baseline.json
 * when establishing a baseline.
 *
 * Gate semantics: prod-enable of facts-in-prompt requires the corpus-level
 * violationRate under the owner-decided bar (candidates: 5% strict / 10%
 * pragmatic-with-correction-surface) on the grown corpus.
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
import { scoreExtraction } from './factEquivalence.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ExtractionGolden {
  id: string;
  category: string;
  isFiction?: boolean;
  episodes: string[];
  knownFacts: { statement: string; entityTags: string[] }[];
  /** Must-recall durable facts — recall is measured against these alone. */
  expectFacts: string[];
  /**
   * Source-supported durable facts that are FINE to extract but not required
   * (methodology v2). Transient states the source supports but that must NOT
   * be extracted are deliberately absent from both lists, so extracting them
   * counts as a violation.
   */
  allowedExtras?: string[];
  expectSupersedesKnownIndex: number[];
}

interface GoldenResult {
  category: string;
  precision: number;
  recall: number;
  extractedCount: number;
  /** Everything the model produced — the eyeballing source for recall misses / tuning. */
  extracted: string[];
  /** Extractions supported by neither list: fabrications OR transient over-extractions. */
  violations: string[];
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
    const allViolations = scored.flatMap(r => r.violations);
    const totalExtracted = scored.reduce((a, r) => a + r.extractedCount, 0);
    const supersessionGoldens = scored.filter(r => r.supersessionHit !== null);
    // Per-category breakdown — the tuning loop reads this to see WHICH failure
    // mode the prompt is making (transient-trap vs fiction vs durable etc).
    // NOTE: these per-category rates are an UNWEIGHTED per-golden macro-average
    // (each golden counts equally), deliberately distinct from
    // `totals.violationRate` above, which is volume-weighted (total violations /
    // total extracted). Macro is the right lens per category (one high-extraction
    // golden shouldn't dominate a category); micro is the right lens for the gate
    // number. Don't compare the two side-by-side expecting them to match.
    const byCategory: Record<string, { goldens: number; violationRate: number; recall: number }> =
      {};
    for (const r of scored) {
      const c = (byCategory[r.category] ??= { goldens: 0, violationRate: 0, recall: 0 });
      c.goldens += 1;
      c.violationRate += r.violations.length / Math.max(1, r.extractedCount);
      c.recall += r.recall;
    }
    for (const c of Object.values(byCategory)) {
      c.violationRate /= c.goldens;
      c.recall /= c.goldens;
    }
    const summary = {
      generatedForPhase: 'set-at-baseline-time',
      methodology:
        'v2 source-grounded: recall vs expectFacts; violation = extraction matching neither expectFacts nor allowedExtras',
      totals: {
        goldens: scored.length,
        meanPrecision: mean(scored.map(r => r.precision)),
        meanRecall: mean(scored.map(r => r.recall)),
        violationRate: totalExtracted === 0 ? 0 : allViolations.length / totalExtracted,
        supersessionHitRate:
          supersessionGoldens.length === 0
            ? null
            : supersessionGoldens.filter(r => r.supersessionHit === true).length /
              supersessionGoldens.length,
      },
      byCategory,
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
        tier: 'observed',
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
      const score = await scoreExtraction(
        extractedStatements,
        golden.expectFacts,
        golden.allowedExtras ?? [],
        embeddings
      );

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
        precision: score.precision,
        recall: score.recall,
        extractedCount: extractedStatements.length,
        extracted: extractedStatements,
        violations: score.violations,
        supersessionHit,
      };

      // Per-golden measurements are recorded, not asserted — the corpus-level
      // means in the results file drive the phase gates. The only hard per-golden
      // invariant is schema validity (above).
    },
    120_000
  );
});
