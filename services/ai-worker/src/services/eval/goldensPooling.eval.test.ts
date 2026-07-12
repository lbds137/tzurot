/**
 * Goldens pooling runner (TREC-style pooled judgment).
 *
 * NOT a CI gate and NOT portable: it reads the LOCAL-ONLY mined corpus from
 * `reports/goldens-mining/` (see `pnpm ops memory:mine-goldens`) and skips
 * itself cleanly when that corpus is absent. Run manually via
 * `pnpm eval:pool-goldens` from the repo root.
 *
 * For each draft query it runs BOTH retrieval arms over the real corpus —
 * dense (the production PgvectorMemoryAdapter path, real local embeddings)
 * and Postgres FTS (ts_rank) — and pools the top-K of each into a judgment
 * sheet. The owner then judges only the pooled candidates (relevant / not),
 * which is what makes ground-truth labeling tractable on a corpus no human
 * can hold in their head: you react to candidates, you never search your
 * memory of 19k exchanges.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { LocalEmbeddingService } from '@tzurot/embeddings';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgvectorMemoryAdapter } from '../PgvectorMemoryAdapter.js';

// Resolved from the repo root — the pnpm script guarantees the cwd.
const WORK_DIR = join(process.cwd(), 'reports/goldens-mining');
const CORPUS_PATH = join(WORK_DIR, 'corpus-raw.json');
const DRAFTS_PATH = join(WORK_DIR, 'query-drafts.json');

const MAIN_USER = '00000000-0000-0000-0000-00000000f001';
const MAIN_PERSONA = '00000000-0000-0000-0000-00000000f002';
const SYSTEM_PROMPT = '00000000-0000-0000-0000-00000000f003';
/** Pool depth per arm — TREC-style shallow pools judge fine at 10. */
const POOL_K = 10;

interface CorpusRow {
  id: string;
  personalityId: string;
  createdAt: string;
  content: string;
  senders: string[];
}

interface QueryDraft {
  id: string;
  targetMemoryId: string;
  message: string;
  style: string;
}

interface PooledCandidate {
  corpusId: string;
  denseRank: number | null;
  ftsRank: number | null;
  isDraftTarget: boolean;
}

const corpusAvailable = existsSync(CORPUS_PATH) && existsSync(DRAFTS_PATH);

describe.skipIf(!corpusAvailable)('goldens pooling (local corpus)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;
  let adapter: PgvectorMemoryAdapter;
  let embeddings: LocalEmbeddingService;
  let corpus: CorpusRow[];
  let drafts: QueryDraft[];
  const pools: Record<string, { message: string; style: string; candidates: PooledCandidate[] }> =
    {};

  beforeAll(async () => {
    corpus = (JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as CorpusRow[]).filter(
      row => row.content.length > 0
    );
    drafts = (JSON.parse(readFileSync(DRAFTS_PATH, 'utf8')) as { drafts: QueryDraft[] }).drafts;

    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: MAIN_USER,
      personaId: MAIN_PERSONA,
      discordId: '900000000000000011',
      username: 'pooluser',
      personaName: 'Pool Persona',
      personaPreferredName: 'Pool',
      personaContent: 'The pooling persona',
    });
    await prisma.$executeRaw`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES (${SYSTEM_PROMPT}::uuid, 'Pool Prompt', 'You are a pooling bot.', NOW())
    `;
    // The corpus rows carry their REAL personality ids — create matching rows
    // so the FK holds and personality-scoped behavior stays faithful.
    const personalityIds = [...new Set(corpus.map(row => row.personalityId))];
    for (const [index, personalityId] of personalityIds.entries()) {
      await prisma.$executeRaw`
        INSERT INTO personalities (id, name, display_name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
        VALUES (${personalityId}::uuid, ${`PoolChar${index}`}, ${`Pool Character ${index}`}, ${`poolchar-${index}`}, ${SYSTEM_PROMPT}::uuid, 'Pooling character', 'Faithful', ${MAIN_USER}::uuid, NOW())
      `;
    }

    embeddings = new LocalEmbeddingService();
    const ready = await embeddings.initialize();
    if (!ready) {
      throw new Error('Local embedding model failed to initialize — pooling cannot run');
    }
    adapter = new PgvectorMemoryAdapter(prisma, embeddings);

    // Seed through the production write path (embeds each row for real);
    // real createdAt preserved for any later recency work. The corpus id
    // rides metadata.sessionId — long rows CHUNK at the embedding token
    // limit, so hit content can never be matched back to the source row by
    // string equality; the carrier column survives per chunk.
    for (const row of corpus) {
      await adapter.addMemory({
        text: row.content,
        metadata: {
          personaId: MAIN_PERSONA,
          personalityId: row.personalityId,
          canonScope: 'personal',
          createdAt: new Date(row.createdAt).getTime(),
          summaryType: 'conversation',
          contextType: 'channel',
          sessionId: row.id,
          messageIds: [],
        },
      });
    }
  }, 900_000);

  afterAll(async () => {
    writeFileSync(join(WORK_DIR, 'pool.json'), `${JSON.stringify({ pools }, null, 2)}\n`);
    writeFileSync(join(WORK_DIR, 'judgment-sheets.md'), buildJudgmentSheets(pools, corpus));
    console.log(
      `\n=== pooling complete: ${Object.keys(pools).length} queries → ${WORK_DIR}/judgment-sheets.md ===`
    );
    // Null-guard each teardown: an early beforeAll throw (e.g. a truncated
    // corpus JSON) leaves these undefined, and an unguarded cleanup would bury
    // the real error under a secondary TypeError.
    await prisma?.$disconnect();
    await pglite?.close();
    await embeddings?.shutdown();
  });

  it('pools both arms for every draft query', { timeout: 900_000 }, async () => {
    for (const draft of drafts) {
      // Dense arm: the production retrieval path, persona-wide (no
      // personality filter — pooling wants candidate diversity), floor-level
      // threshold so ranking (not the production cutoff) decides the pool.
      const denseHits = await adapter.queryMemories(draft.message, {
        personaId: MAIN_PERSONA,
        limit: POOL_K,
        scoreThreshold: 0.01,
      });
      // Chunk siblings share a carrier id — dedup keeps the best (first) rank.
      const denseIds = [
        ...new Set(
          denseHits
            .map(hit => (hit.metadata as { sessionId?: string | null }).sessionId ?? undefined)
            .filter((id): id is string => id !== undefined)
        ),
      ];

      // FTS arm: OR-of-lexemes (the parked hybrid branch's FTS-OR shape) —
      // plainto_tsquery ANDs every word, and a conversational message never
      // matches ALL its terms, so AND semantics return zero rows on real
      // chat queries. ts_rank still rewards multi-term matches.
      const orQuery = draft.message
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 1)
        .join(' | ');
      // Empty after stripping (all single-char / all-stopword) → to_tsquery('')
      // matches nothing silently; skip so a thin sheet has an obvious cause.
      const ftsRows =
        orQuery.length === 0
          ? []
          : // Same persona_id + visibility scoping as the dense arm's
            // buildWhereConditions — a no-op on today's single-persona,
            // all-normal corpus, but keeps the two arms comparable if a 1c
            // variant ever seeds a second persona or a soft-deleted row.
            await prisma.$queryRaw<{ session_id: string | null }[]>`
              SELECT session_id, MAX(ts_rank(to_tsvector('english', content), to_tsquery('english', ${orQuery}))) AS best_rank
              FROM memories
              WHERE persona_id = ${MAIN_PERSONA}::uuid
                AND visibility = 'normal'
                AND to_tsvector('english', content) @@ to_tsquery('english', ${orQuery})
              GROUP BY session_id
              ORDER BY best_rank DESC
              LIMIT ${POOL_K}
            `;
      const ftsIds = ftsRows
        .map(row => row.session_id ?? undefined)
        .filter((id): id is string => id !== undefined);

      const pooled = new Map<string, PooledCandidate>();
      const ensure = (corpusId: string): PooledCandidate => {
        const existing = pooled.get(corpusId) ?? {
          corpusId,
          denseRank: null,
          ftsRank: null,
          isDraftTarget: corpusId === draft.targetMemoryId,
        };
        pooled.set(corpusId, existing);
        return existing;
      };
      denseIds.forEach((id, index) => {
        ensure(id).denseRank = index + 1;
      });
      ftsIds.forEach((id, index) => {
        ensure(id).ftsRank = index + 1;
      });
      // The draft target always appears on the sheet, even when BOTH arms
      // missed it (both ranks stay null) — a missed target is the most
      // informative judgment row.
      ensure(draft.targetMemoryId);

      pools[draft.id] = {
        message: draft.message,
        style: draft.style,
        candidates: [...pooled.values()],
      };
    }
    expect(Object.keys(pools)).toHaveLength(drafts.length);
  });
});

function buildJudgmentSheets(
  pools: Record<string, { message: string; style: string; candidates: PooledCandidate[] }>,
  corpus: { id: string; createdAt: string; content: string }[]
): string {
  const byId = new Map(corpus.map(row => [row.id, row]));
  const lines = [
    '# Goldens pooled-judgment sheets',
    '',
    'For each query: mark every candidate `[R]` relevant, `[S]` sort-of, or leave `[ ]` not',
    'relevant. You are judging ONLY what is listed — no need to recall anything beyond it.',
    '`◆ TARGET` marks the memory the query was drafted from (judge it too — if it reads as',
    'not actually relevant, that is a legitimate verdict and kills that golden).',
    'A target with no rank in either column means BOTH arms missed it — the interesting case.',
    '',
  ];
  for (const [queryId, pool] of Object.entries(pools)) {
    lines.push(`---`, ``, `## ${queryId} (${pool.style})`, ``, `> ${pool.message}`, ``);
    const sorted = [...pool.candidates].sort(
      (a, b) => (a.denseRank ?? 99) + (a.ftsRank ?? 99) - ((b.denseRank ?? 99) + (b.ftsRank ?? 99))
    );
    for (const candidate of sorted) {
      const row = byId.get(candidate.corpusId);
      const text =
        row === undefined ? '(row missing)' : row.content.replace(/\s+/g, ' ').slice(0, 240);
      const marks = [
        candidate.isDraftTarget ? '◆ TARGET' : null,
        candidate.denseRank !== null ? `D#${candidate.denseRank}` : null,
        candidate.ftsRank !== null ? `F#${candidate.ftsRank}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      lines.push(
        `- [ ] \`${candidate.corpusId.slice(0, 8)}\` ${marks} (${row?.createdAt.slice(0, 10) ?? '?'})`,
        `      ${text}…`,
        ``
      );
    }
  }
  return lines.join('\n');
}
