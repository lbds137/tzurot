/**
 * Pgvector Query Builder
 * Constructs Prisma.sql queries for pgvector operations
 */

import { Prisma } from '@tzurot/common-types';
import { isValidId } from '../utils/memoryUtils.js';
import type { MemoryQueryOptions } from './PgvectorTypes.js';

/**
 * Build WHERE conditions for memory query based on options
 */
export function buildWhereConditions(options: MemoryQueryOptions): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [Prisma.sql`m.persona_id = ${options.personaId}::uuid`];

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
 * Build the complete similarity search query
 */
export function buildSimilaritySearchQuery(
  embeddingVector: string,
  whereConditions: Prisma.Sql[],
  maxDistance: number,
  limit: number
): Prisma.Sql {
  const whereClause = Prisma.join(whereConditions, ' AND ');

  // NOTE: The embedding vector must use Prisma.raw() because:
  // 1. pgvector requires exact '[n,n,n,...]' format which can't be parameterized
  // 2. embeddingVector is validated and constructed from numeric array only (safe)
  // 3. Prisma.raw() cannot be nested in Prisma.sql, so we use Prisma.join() instead
  // Uses local BGE embeddings (384 dimensions) for similarity search
  return Prisma.join(
    [
      Prisma.sql`
        SELECT
          m.id,
          m.persona_id,
          m.personality_id,
          m.content,
          m.embedding <=> `,
      Prisma.raw(`'${embeddingVector}'::vector`),
      Prisma.sql` AS distance,
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
        FROM memories m
        JOIN personas persona ON m.persona_id = persona.id
        JOIN users owner ON persona.owner_id = owner.id
        JOIN personalities personality ON m.personality_id = personality.id
        WHERE `,
      whereClause,
      Prisma.sql`
          AND m.embedding IS NOT NULL
          AND m.embedding <=> `,
      Prisma.raw(`'${embeddingVector}'::vector`),
      Prisma.sql` < ${maxDistance}
        ORDER BY distance ASC
        LIMIT ${limit}
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
} {
  const limit =
    options.limit !== undefined && options.limit !== null && options.limit > 0 ? options.limit : 10;

  // scoreThreshold is MINIMUM similarity (0-1 range)
  // Default 0.85 = only show highly similar memories
  const minSimilarity =
    options.scoreThreshold !== undefined &&
    options.scoreThreshold !== null &&
    options.scoreThreshold > 0
      ? options.scoreThreshold
      : 0.85;

  // pgvector distance: 0 = identical, 2 = opposite (practically 0-1 for normalized embeddings)
  // Cosine Distance = 1 - Cosine Similarity
  // If we want similarity > 0.85, we need distance < (1 - 0.85) = 0.15
  const maxDistance = 1 - minSimilarity;

  return { limit, minSimilarity, maxDistance };
}
