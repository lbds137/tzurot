/**
 * FactStore — persistence layer for memory_facts (memory Phase 2)
 *
 * Owns the three fact queries the extraction worker needs:
 *   1. recent ACTIVE same-scope facts, token-budgeted (supersession context)
 *   2. similarity search over active facts (the always-on supersession fallback)
 *   3. the transactional fact-write + supersession marking
 *
 * Deliberately NOT part of PgvectorMemoryAdapter: facts are a different table
 * with a different lifecycle (supersession, no chunking). The 384-dim guard
 * mirrors the adapter's; embedding happens at write time, same transaction
 * boundary as the row.
 */

import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import { LOCAL_EMBEDDING_DIMENSIONS, type IEmbeddingService } from '@tzurot/embeddings';
import { generateMemoryFactUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('FactStore');

/** A fact as injected into the extraction prompt's supersession context.
 * Locked facts stay IN the context (so the extractor doesn't re-extract
 * duplicates) but are excluded from supersession-target resolution — user
 * lock protection must hold against automatic supersession too. */
export interface FactForContext {
  id: string;
  statement: string;
  entityTags: string[];
  isLocked: boolean;
}

/** A similarity-fallback candidate. */
export interface SimilarFact {
  id: string;
  statement: string;
  entityTags: string[];
  similarity: number;
  isLocked: boolean;
}

/** Input for a new fact write. */
export interface NewFact {
  personalityId: string;
  personaId: string | null;
  statement: string;
  entityTags: string[];
  salience: number;
  isFiction: boolean;
  sourceMemoryIds: string[];
  extractionJobId: string;
}

export class FactStore {
  constructor(
    private readonly prisma: PrismaClient,
    // Interface, not the concrete LocalEmbeddingService — the generation-side
    // FactRetriever (slice 4a) reuses this store with the shared adapter's
    // embedder; only isServiceReady/getEmbedding are used.
    private readonly embeddingService: IEmbeddingService
  ) {}

  /**
   * Recent active (non-superseded, non-forgotten, visible) facts for the
   * scope, newest first, trimmed to a token budget — the numbered list the
   * extraction prompt injects so the model can name supersession targets.
   */
  async getRecentActiveFacts(
    personalityId: string,
    personaId: string | null,
    tokenBudget: number
  ): Promise<FactForContext[]> {
    const rows = await this.prisma.memoryFact.findMany({
      where: {
        personalityId,
        personaId,
        supersededAt: null,
        forgotten: false,
        visibility: 'normal',
      },
      orderBy: { validFrom: 'desc' },
      select: { id: true, statement: true, entityTags: true, isLocked: true },
      take: 100, // hard ceiling before the token trim
    });

    const result: FactForContext[] = [];
    let tokens = 0;
    for (const row of rows) {
      const factTokens = countTextTokens(row.statement) + 10; // formatting overhead
      if (tokens + factTokens > tokenBudget) {
        break;
      }
      result.push(row);
      tokens += factTokens;
    }
    return result;
  }

  /**
   * Top-K active facts by cosine similarity to `embedding`. Two callers:
   * (1) the extraction supersession fallback (catches near-dup targets that
   * fell outside the injected context window); (2) generation-time fact
   * retrieval (`FactRetriever`, Phase 2 slice 4a). Returns similarity as
   * 1 - cosine distance.
   *
   * Ordered by cosine distance, then `valid_from DESC, salience DESC` as
   * tiebreakers so that among near-equidistant facts the most RECENT and most
   * SALIENT wins — a stale-but-similar fact can't beat a recent correction.
   * (This is a tiebreak, not composite scoring; full type/salience weighting
   * is a later phase.) The tiebreak only reorders equal-distance rows, so it's
   * inert for the supersession-fallback caller.
   */
  async findSimilarActiveFacts(
    embedding: number[],
    personalityId: string,
    personaId: string | null,
    limit = 5
  ): Promise<SimilarFact[]> {
    const embeddingVector = `[${embedding.join(',')}]`;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        statement: string;
        entity_tags: string[];
        is_locked: boolean;
        similarity: number;
      }[]
    >(
      Prisma.join(
        [
          Prisma.sql`
        SELECT f.id, f.statement, f.entity_tags, f.is_locked,
               1 - (f.embedding <=> `,
          Prisma.raw(`'${embeddingVector}'::vector`),
          Prisma.sql`) AS similarity
        FROM memory_facts f
        WHERE f.personality_id = ${personalityId}::uuid
          AND f.persona_id `,
          personaId === null ? Prisma.sql`IS NULL` : Prisma.sql`= ${personaId}::uuid`,
          Prisma.sql`
          AND f.superseded_at IS NULL
          AND f.forgotten = false
          AND f.visibility = 'normal'
          AND f.embedding IS NOT NULL
        ORDER BY f.embedding <=> `,
          Prisma.raw(`'${embeddingVector}'::vector`),
          Prisma.sql` ASC, f.valid_from DESC, f.salience DESC
        LIMIT ${limit}
      `,
        ],
        ''
      )
    );
    return rows.map(r => ({
      id: r.id,
      statement: r.statement,
      entityTags: r.entity_tags,
      similarity: r.similarity,
      isLocked: r.is_locked,
    }));
  }

  /**
   * Write one fact and mark its supersessions, atomically.
   *
   * The row insert uses raw SQL because Prisma can't write Unsupported
   * (vector) columns through the typed client; the supersession updates ride
   * the same transaction so a crash can't leave a new fact without its
   * supersession marks (or vice versa). The embedding is precomputed by the
   * caller (via embedStatement) because the similarity fallback needs it
   * BEFORE the write.
   *
   * Revival semantics: the id is a content hash, so re-asserting a
   * previously-SUPERSEDED statement collides with its dead row — the conflict
   * branch REACTIVATES it (clears the supersession marks), otherwise a
   * Seattle→Denver→Seattle sequence would end with no active fact at all.
   * FORGOTTEN facts stay dead (user removal is terminal) and locked rows are
   * never touched; a same-batch retry of an ACTIVE fact no-ops as before.
   *
   * @returns the new fact's id
   */
  async writeFactWithSupersessions(
    fact: NewFact,
    supersededIds: string[],
    embedding: number[]
  ): Promise<string> {
    const embeddingVector = `[${embedding.join(',')}]`;
    const id = generateMemoryFactUuid(fact.personalityId, fact.personaId, fact.statement);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.$executeRaw(
        Prisma.join(
          [
            Prisma.sql`
          INSERT INTO memory_facts
            (id, personality_id, persona_id, pool, is_fiction, statement, embedding,
             entity_tags, salience, tier, valid_from, source_memory_ids, extraction_job_id,
             created_at, updated_at)
          VALUES
            (${id}::uuid, ${fact.personalityId}::uuid, ${fact.personaId}::uuid, 'private',
             ${fact.isFiction}, ${fact.statement}, `,
            Prisma.raw(`'${embeddingVector}'::vector`),
            Prisma.sql`,
             ${fact.entityTags}::text[], ${fact.salience}, 'observed', ${now}, ${fact.sourceMemoryIds}::text[],
             ${fact.extractionJobId}, ${now}, ${now})
          ON CONFLICT (id) DO UPDATE SET
            superseded_at = NULL,
            superseded_by_id = NULL,
            salience = EXCLUDED.salience,
            source_memory_ids = EXCLUDED.source_memory_ids,
            extraction_job_id = EXCLUDED.extraction_job_id,
            updated_at = EXCLUDED.updated_at
          WHERE memory_facts.superseded_at IS NOT NULL
            AND memory_facts.forgotten = false
            AND memory_facts.is_locked = false
        `,
          ],
          ''
        )
      ),
      this.prisma.memoryFact.updateMany({
        where: { id: { in: supersededIds }, supersededAt: null },
        data: { supersededAt: now, supersededById: id },
      }),
    ]);

    logger.debug(
      { factId: id, supersededCount: supersededIds.length },
      'Fact written with supersessions'
    );
    return id;
  }

  /** 384-dim guarded embedding (mirrors PgvectorMemoryAdapter's invariant). */
  async embedStatement(text: string): Promise<number[]> {
    if (!this.embeddingService.isServiceReady()) {
      throw new Error('Embedding service is not ready');
    }
    const embedding = await this.embeddingService.getEmbedding(text);
    if (embedding === undefined || embedding.length === 0) {
      throw new Error('Embedding service returned no embedding');
    }
    if (embedding.length !== LOCAL_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Invalid embedding dimensions: expected ${LOCAL_EMBEDDING_DIMENSIONS}, got ${embedding.length}`
      );
    }
    return Array.from(embedding);
  }
}
