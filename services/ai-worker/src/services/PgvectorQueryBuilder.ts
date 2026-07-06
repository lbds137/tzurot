/**
 * Pgvector Query Builder
 * Constructs Prisma.sql queries for pgvector operations.
 *
 * Retrieval is a HYBRID of three rank arms fused with Reciprocal Rank
 * Fusion in one CTE (memory-architecture §3.4) —
 *   dense  — cosine over embeddings (the original path), gated by the
 *            user-facing memoryScoreThreshold (semantic-similarity gate);
 *   fts    — Postgres full-text search over content (english config,
 *            websearch_to_tsquery), deliberately UNGATED by similarity so
 *            exact-word matches (names, handles, codewords) surface even when
 *            their embedding similarity is low — the recall class dense-only
 *            retrieval measurably misses (see eval golden
 *            `stemmed-keyword-recall`, recall 0 pre-1a);
 *   recency — a mild rank over the union of both arms' candidates by
 *            created_at DESC (re-ranks retrieved candidates; never introduces
 *            new ones).
 *
 * Downstream consumes array ORDER (MemoryBudgetManager walks in order); the
 * numeric score is logging/diagnostics only, so `score` becomes the fused RRF
 * value with per-arm components carried alongside for explain-in-inspect.
 */

import { AI_DEFAULTS } from '@tzurot/common-types/constants/ai';
import { Prisma } from '@tzurot/common-types/services/prisma';
import { isValidId } from '../utils/memoryUtils.js';
import type { MemoryQueryOptions } from './PgvectorTypes.js';

/**
 * RRF smoothing constant — the standard k=60 from the original RRF paper;
 * larger k flattens rank differences, smaller k sharpens the top ranks.
 */
export const RRF_K = 60;

/**
 * Per-arm fusion weights. Dense and FTS are equal partners; recency is a mild
 * tiebreaker-strength signal (a fresh memory should win between near-equals,
 * not outrank a strong match). Tuned against the eval corpus — change these
 * only with a before/after `pnpm eval:memory` run.
 */
export const RRF_WEIGHTS = {
  dense: 1.0,
  fts: 1.0,
  recency: 0.25,
} as const;

/**
 * Per-arm candidate pool sizing: each arm contributes its top
 * `max(limit * CANDIDATE_MULTIPLIER, MIN_CANDIDATE_POOL)` rows to fusion, so
 * a memory ranked just outside the final limit on one arm can still win via
 * agreement across arms.
 */
export const CANDIDATE_MULTIPLIER = 5;
export const MIN_CANDIDATE_POOL = 50;

/**
 * Build WHERE conditions for memory query based on options
 */
export function buildWhereConditions(options: MemoryQueryOptions): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`m.persona_id = ${options.personaId}::uuid`,
    // Soft-deleted/hidden/archived memories must never reach RAG retrieval —
    // every deletion path in the app is a soft delete (visibility='deleted'),
    // so omitting this filter silently violates the user's explicit deletion.
    Prisma.sql`m.visibility = 'normal'`,
  ];

  // Optional personality filter
  if (isValidId(options.personalityId)) {
    conditions.push(Prisma.sql`m.personality_id = ${options.personalityId}::uuid`);
  }

  // Exclude newer memories (for conversation history overlap prevention)
  if (
    options.excludeNewerThan !== undefined &&
    options.excludeNewerThan !== null &&
    options.excludeNewerThan > 0
  ) {
    const excludeDate = new Date(options.excludeNewerThan).toISOString();
    conditions.push(Prisma.sql`m.created_at < ${excludeDate}::timestamptz`);
  }

  // Exclude specific memory IDs (for waterfall deduplication)
  if (options.excludeIds !== undefined && options.excludeIds.length > 0) {
    const excludeUuids = options.excludeIds.map(id => Prisma.sql`${id}::uuid`);
    conditions.push(Prisma.sql`m.id NOT IN (${Prisma.join(excludeUuids, ', ')})`);
  }

  // Filter by channel IDs (for channel-scoped queries)
  if (options.channelIds !== undefined && options.channelIds.length > 0) {
    const channelValues = options.channelIds.map(id => Prisma.sql`${id}`);
    conditions.push(Prisma.sql`m.channel_id IN (${Prisma.join(channelValues, ', ')})`);
  }

  return conditions;
}

/**
 * Convert raw query text into websearch syntax with OR semantics.
 *
 * websearch_to_tsquery defaults to AND across terms — wrong for memory
 * recall, where a query like "spelunker stories" should match a memory
 * containing only "spelunking" (the distinctive term carries the signal;
 * the filler term must not veto the match). Joining terms with the
 * websearch OR operator keeps websearch's safe, never-throws parsing while
 * ranking multi-term matches above single-term ones via ts_rank.
 */
export function buildFtsQueryText(query: string): string {
  return query.trim().split(/\s+/).join(' OR ');
}

/** Inputs for {@link buildHybridSearchQuery} (options object per max-params). */
export interface HybridSearchQueryOptions {
  /** Validated '[n,n,...]' pgvector literal (numeric-array-constructed only). */
  embeddingVector: string;
  /** Raw user query text — feeds the FTS arm via buildFtsQueryText. */
  rawQueryText: string;
  whereConditions: Prisma.Sql[];
  /** Dense-arm gate: cosine distance ceiling (1 - minSimilarity). */
  maxDistance: number;
  limit: number;
  candidateLimit: number;
}

/** Dense arm: cosine candidates gated by the similarity threshold. */
function buildDenseArm(
  vector: Prisma.Sql,
  whereClause: Prisma.Sql,
  maxDistance: number,
  candidateLimit: number
): Prisma.Sql {
  return Prisma.join(
    [
      Prisma.sql`
        dense AS (
          SELECT id, distance,
                 ROW_NUMBER() OVER (ORDER BY distance ASC) AS arm_rank
          FROM (
            SELECT m.id, m.embedding <=> `,
      vector,
      Prisma.sql` AS distance
            FROM memories m
            WHERE `,
      whereClause,
      Prisma.sql`
              AND m.embedding IS NOT NULL
              AND m.embedding <=> `,
      vector,
      Prisma.sql` < ${maxDistance}
            ORDER BY distance ASC
            LIMIT ${candidateLimit}
          ) dense_candidates
        )`,
    ],
    ''
  );
}

/** FTS arm: lexical candidates, rank-limited but never similarity-gated. */
function buildFtsArm(
  queryText: string,
  whereClause: Prisma.Sql,
  candidateLimit: number
): Prisma.Sql {
  return Prisma.join(
    [
      Prisma.sql`
        fts AS (
          SELECT id,
                 ROW_NUMBER() OVER (ORDER BY fts_score DESC) AS arm_rank
          FROM (
            SELECT m.id,
                   ts_rank(to_tsvector('english', m.content),
                           websearch_to_tsquery('english', ${queryText})) AS fts_score
            FROM memories m
            WHERE `,
      whereClause,
      Prisma.sql`
              AND to_tsvector('english', m.content) @@ websearch_to_tsquery('english', ${queryText})
            ORDER BY fts_score DESC
            LIMIT ${candidateLimit}
          ) fts_candidates
        )`,
    ],
    ''
  );
}

/** Fusion tail: FULL OUTER join of arms, recency rank over candidates, RRF sum. */
function buildFusionCtes(): Prisma.Sql {
  return Prisma.sql`
        candidates AS (
          SELECT COALESCE(d.id, f.id) AS id,
                 d.distance AS dense_distance,
                 d.arm_rank AS dense_rank,
                 f.arm_rank AS fts_rank
          FROM dense d
          FULL OUTER JOIN fts f ON d.id = f.id
        ),
        recency AS (
          SELECT c.id,
                 ROW_NUMBER() OVER (ORDER BY mem.created_at DESC) AS arm_rank
          FROM candidates c
          JOIN memories mem ON mem.id = c.id
        ),
        fused AS (
          SELECT c.id,
                 c.dense_distance,
                 c.dense_rank,
                 c.fts_rank,
                 r.arm_rank AS recency_rank,
                 COALESCE(${RRF_WEIGHTS.dense}::float8 / (${RRF_K} + c.dense_rank), 0)
               + COALESCE(${RRF_WEIGHTS.fts}::float8 / (${RRF_K} + c.fts_rank), 0)
               + ${RRF_WEIGHTS.recency}::float8 / (${RRF_K} + r.arm_rank) AS rrf_score
          FROM candidates c
          JOIN recency r ON r.id = c.id
        )`;
}

/**
 * Build the hybrid (dense + FTS + recency, RRF-fused) search query.
 *
 * The embedding vector must use Prisma.raw() because pgvector requires the
 * exact '[n,n,...]' literal which can't be parameterized; it is constructed
 * from a validated numeric array only (safe). The FTS query text IS a normal
 * parameter — websearch_to_tsquery accepts arbitrary user text safely.
 *
 * Threshold semantics: the similarity gate applies to the DENSE ARM ONLY. The FTS arm is rank-limited but never
 * similarity-gated, so lexical matches survive regardless of embedding
 * distance. An empty/stopword-only query text yields an empty tsquery that
 * matches nothing — the query degrades gracefully to dense-only.
 */
export function buildHybridSearchQuery(options: HybridSearchQueryOptions): Prisma.Sql {
  const whereClause = Prisma.join(options.whereConditions, ' AND ');
  const vector = Prisma.raw(`'${options.embeddingVector}'::vector`);
  const queryText = buildFtsQueryText(options.rawQueryText);

  return Prisma.join(
    [
      Prisma.sql`
        WITH `,
      buildDenseArm(vector, whereClause, options.maxDistance, options.candidateLimit),
      Prisma.sql`,
        `,
      buildFtsArm(queryText, whereClause, options.candidateLimit),
      Prisma.sql`,
        `,
      buildFusionCtes(),
      Prisma.sql`
        SELECT
          m.id,
          m.persona_id,
          m.personality_id,
          m.content,
          fused.dense_distance AS distance,
          fused.dense_rank,
          fused.fts_rank,
          fused.recency_rank,
          fused.rrf_score,
          m.session_id,
          m.canon_scope,
          m.summary_type,
          m.channel_id,
          m.guild_id,
          m.message_ids,
          m.senders,
          m.created_at,
          m.chunk_group_id,
          m.chunk_index,
          m.total_chunks,
          COALESCE(persona.preferred_name, persona.name) as persona_name,
          owner.username as owner_username,
          COALESCE(personality.display_name, personality.name) as personality_name
        FROM fused
        JOIN memories m ON m.id = fused.id
        JOIN personas persona ON m.persona_id = persona.id
        JOIN users owner ON persona.owner_id = owner.id
        JOIN personalities personality ON m.personality_id = personality.id
        ORDER BY fused.rrf_score DESC, m.created_at DESC
        LIMIT ${options.limit}
      `,
    ],
    ''
  );
}

/**
 * Parse query options into normalized values with defaults
 */
export function parseQueryOptions(options: MemoryQueryOptions): {
  limit: number;
  minSimilarity: number;
  maxDistance: number;
  candidateLimit: number;
} {
  const limit =
    options.limit !== undefined && options.limit !== null && options.limit > 0 ? options.limit : 10;

  // scoreThreshold gates the DENSE ARM only (minimum cosine similarity, 0-1).
  // Default mirrors the config default — the previous hardcoded 0.85 fallback
  // was dead in production (MemoryRetriever always passes a threshold) and
  // contradicted AI_DEFAULTS.
  const minSimilarity =
    options.scoreThreshold !== undefined &&
    options.scoreThreshold !== null &&
    options.scoreThreshold > 0
      ? options.scoreThreshold
      : AI_DEFAULTS.MEMORY_SCORE_THRESHOLD;

  // pgvector distance: 0 = identical, 2 = opposite (practically 0-1 for normalized embeddings)
  // Cosine Distance = 1 - Cosine Similarity
  const maxDistance = 1 - minSimilarity;

  const candidateLimit = Math.max(limit * CANDIDATE_MULTIPLIER, MIN_CANDIDATE_POOL);

  return { limit, minSimilarity, maxDistance, candidateLimit };
}
