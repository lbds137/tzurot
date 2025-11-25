#!/usr/bin/env tsx
/**
 * Rebuild memories table from conversation_history
 *
 * This script:
 * - Fetches all conversation history from Postgres
 * - Pairs user->assistant messages robustly (handles ordering bugs)
 * - Generates embeddings for each memory
 * - Inserts into memories table with pgvector
 *
 * Handles timestamp inversions and malformed pairs gracefully.
 */

import { getPrismaClient } from '@tzurot/common-types';
import { OpenAI } from 'openai';
import { v5 as uuidv5 } from 'uuid';
import crypto from 'crypto';
import { createLogger } from '../../packages/common-types/src/logger.js';

const logger = createLogger('MemoryRebuild');
const prisma = getPrismaClient();

// Namespace UUID for memories
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const MEMORY_NAMESPACE = uuidv5('tzurot-v3-memory', DNS_NAMESPACE);

// Helper to hash content
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 32);
}

// Helper to generate deterministic memory UUID
function deterministicMemoryUuid(
  personaId: string,
  personalityId: string,
  content: string
): string {
  const key = `${personaId}:${personalityId}:${hashContent(content)}`;
  return uuidv5(key, MEMORY_NAMESPACE);
}

const EMBEDDING_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 50; // Process 50 memories at a time
const DRY_RUN = process.env.DRY_RUN === 'true'; // Set DRY_RUN=true to test without writing

interface ConversationExchange {
  userMessage: string;
  assistantMessage: string;
  channelId: string;
  personaId: string;
  personalityId: string;
  personalityName: string;
  guildId?: string;
  messageIds: string[];
  senders: string[];
  createdAt: Date;
}

async function main() {
  logger.info('=== Memory Rebuild from Conversation History ===');
  logger.info(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will write to database)'}`);

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Step 1: Get all distinct persona/personality/channel combinations
  logger.info('\n📊 Step 1: Finding conversation contexts...');
  const contexts = await prisma.conversationHistory.findMany({
    select: {
      channelId: true,
      personalityId: true,
      personaId: true,
      personality: {
        select: {
          name: true,
        },
      },
    },
    distinct: ['channelId', 'personalityId', 'personaId'],
  });

  logger.info(`Found ${contexts.length} unique conversation contexts`);

  let totalMemories = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Step 2: Process each context
  for (const context of contexts) {
    const { channelId, personalityId, personaId, personality } = context;
    logger.info(
      `\n🔄 Processing: channel=${channelId.slice(0, 8)}... persona=${personaId.slice(0, 8)}... personality=${personality.name}`
    );

    try {
      // Fetch all messages for this context, sorted by timestamp
      const messages = await prisma.conversationHistory.findMany({
        where: {
          channelId,
          personalityId,
          personaId,
        },
        orderBy: {
          createdAt: 'asc', // Sort by timestamp - handles ordering bugs
        },
        select: {
          role: true,
          content: true,
          createdAt: true,
          channelId: true,
        },
      });

      if (messages.length === 0) {
        logger.info(`  ⏭️  No messages, skipping`);
        continue;
      }

      // Pair messages into exchanges (user -> assistant)
      const exchanges = pairMessages(messages, personaId, personalityId, personality.name);

      logger.info(
        `  Found ${messages.length} messages → ${exchanges.length} valid exchanges (${messages.length - exchanges.length * 2} skipped)`
      );
      totalSkipped += messages.length - exchanges.length * 2;

      if (exchanges.length === 0) {
        logger.warn(`  ⚠️  No valid exchanges found`);
        continue;
      }

      // Generate embeddings and insert memories in batches
      for (let i = 0; i < exchanges.length; i += BATCH_SIZE) {
        const batch = exchanges.slice(i, i + BATCH_SIZE);
        logger.info(
          `  Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(exchanges.length / BATCH_SIZE)} (${batch.length} exchanges)...`
        );

        for (const exchange of batch) {
          try {
            // Format the memory content
            const memoryContent = `User: ${exchange.userMessage}\n\nAssistant: ${exchange.assistantMessage}`;

            // Generate embedding
            const embeddingResponse = await openai.embeddings.create({
              model: EMBEDDING_MODEL,
              input: memoryContent,
            });
            const embedding = embeddingResponse.data[0].embedding;

            if (!DRY_RUN) {
              // Generate deterministic UUID for this memory
              const memoryId = deterministicMemoryUuid(
                exchange.personaId,
                exchange.personalityId,
                memoryContent
              );

              // Insert into memories table (raw SQL since Prisma doesn't support vector type well)
              await prisma.$executeRaw`
                INSERT INTO memories (
                  id,
                  persona_id,
                  personality_id,
                  personality_name,
                  content,
                  embedding,
                  channel_id,
                  guild_id,
                  message_ids,
                  senders,
                  is_summarized,
                  created_at
                ) VALUES (
                  ${memoryId}::uuid,
                  ${exchange.personaId}::uuid,
                  ${exchange.personalityId}::uuid,
                  ${exchange.personalityName},
                  ${memoryContent},
                  ${`[${embedding.join(',')}]`}::vector(1536),
                  ${exchange.channelId},
                  ${exchange.guildId || null},
                  ${exchange.messageIds}::text[],
                  ${exchange.senders}::text[],
                  false,
                  ${exchange.createdAt}
                )
                ON CONFLICT (id) DO NOTHING
              `;
            }

            totalMemories++;
          } catch (error) {
            totalErrors++;
            logger.error({ err: error, exchange }, 'Failed to process exchange');
          }
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      logger.info(`  ✅ Completed: ${exchanges.length} memories created`);
    } catch (error) {
      totalErrors++;
      logger.error({ err: error, context }, 'Failed to process context');
    }
  }

  // Summary
  logger.info('\n=== Summary ===');
  logger.info(`Total memories created: ${totalMemories}`);
  logger.info(`Total messages skipped: ${totalSkipped}`);
  logger.info(`Total errors: ${totalErrors}`);
  logger.info(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);

  await prisma.$disconnect();
}

/**
 * Pair messages into valid user->assistant exchanges
 * Handles ordering bugs and malformed sequences
 */
function pairMessages(
  messages: Array<{ role: string; content: string; createdAt: Date; channelId: string }>,
  personaId: string,
  personalityId: string,
  personalityName: string
): ConversationExchange[] {
  const exchanges: ConversationExchange[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    // Look for a user message
    if (msg.role === 'user') {
      // Look for the next assistant message
      let j = i + 1;
      while (j < messages.length && messages[j].role !== 'assistant') {
        j++; // Skip any non-assistant messages (like system messages or duplicate users)
      }

      if (j < messages.length) {
        // Found a valid user->assistant pair
        const userMsg = messages[i];
        const assistantMsg = messages[j];

        exchanges.push({
          userMessage: userMsg.content,
          assistantMessage: assistantMsg.content,
          channelId: userMsg.channelId,
          personaId,
          personalityId,
          personalityName,
          messageIds: [], // We don't have original message IDs in conversation_history
          senders: [], // We don't track senders in conversation_history
          createdAt: userMsg.createdAt, // Use user message timestamp
        });

        i = j + 1; // Move past this pair
      } else {
        // No matching assistant message, skip this user message
        logger.debug(`Skipping orphan user message at index ${i}`);
        i++;
      }
    } else {
      // Not a user message (assistant or system), skip it
      i++;
    }
  }

  return exchanges;
}

main().catch(error => {
  logger.error({ err: error }, 'Fatal error in memory rebuild');
  process.exit(1);
});
