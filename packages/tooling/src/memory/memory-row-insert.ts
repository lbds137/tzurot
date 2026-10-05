/**
 * Shared memory-row insert + local-embedding lifecycle for the memory tooling
 * commands that write `memories` rows directly (LTM backfill, conversation import).
 *
 * Both commands write the same 19-column row; only the per-row values differ
 * (channel/guild/message ids, the `source_system` tag). Keeping the INSERT in
 * one place stops the two column lists from drifting apart.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { LocalEmbeddingService } from '@tzurot/embeddings';

/** Every value interpolated into the memory INSERT. */
export interface MemoryRowInsert {
  id: string;
  personaId: string;
  personalityId: string;
  content: string;
  embedding: Float32Array;
  channelId: string | null;
  guildId: string | null;
  messageIds: string[];
  createdAt: Date;
  sourceSystem: string;
}

/** The slice of the embedding service the insert loops use. */
export type EmbeddingProvider = Pick<LocalEmbeddingService, 'getEmbedding'>;

/** Insert one memory with its embedding via raw SQL (idempotent). Returns true when a row was written. */
export async function insertMemoryRow(
  prisma: PrismaClient,
  row: MemoryRowInsert
): Promise<boolean> {
  const embeddingStr = `[${Array.from(row.embedding).join(',')}]`;
  const now = new Date();

  const result = await prisma.$executeRaw`
    INSERT INTO memories (
      id, persona_id, personality_id, content, embedding,
      is_summarized, session_id, canon_scope, summary_type,
      channel_id, guild_id, message_ids, senders,
      created_at, updated_at, source_system, type, is_locked, visibility
    ) VALUES (
      ${row.id}::uuid, ${row.personaId}::uuid, ${row.personalityId}::uuid,
      ${row.content}, ${embeddingStr}::vector,
      false, NULL, 'personal', NULL,
      ${row.channelId}, ${row.guildId}, ${row.messageIds}, ARRAY[]::text[],
      ${row.createdAt}, ${now}, ${row.sourceSystem}, 'memory', false, 'normal'
    )
    ON CONFLICT (id) DO NOTHING
  `;

  return result > 0;
}

/**
 * Run `fn` with an initialized in-process embedding service, and always shut it
 * down afterwards — also when initialization fails or `fn` throws.
 */
export async function withLocalEmbeddings<T>(
  fn: (embeddings: EmbeddingProvider) => Promise<T>
): Promise<T> {
  const { LocalEmbeddingService: Service } = await import('@tzurot/embeddings');
  const embeddingService = new Service();
  try {
    if (!(await embeddingService.initialize())) {
      throw new Error('Failed to initialize embedding service');
    }
    return await fn(embeddingService);
  } finally {
    await embeddingService.shutdown();
  }
}
