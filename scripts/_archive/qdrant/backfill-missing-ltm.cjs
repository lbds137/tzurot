#!/usr/bin/env node
/**
 * Backfill Missing LTM
 * Finds conversation pairs that are missing from Qdrant and backfills them
 * Uses the audit script logic to identify gaps
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { OpenAIEmbeddings } = require('@langchain/openai');

const prisma = new PrismaClient();
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: 'text-embedding-3-small',
});

async function backfillMissingLTM(userId, personalityId, dryRun = false) {
  console.log(`\n🔧 Backfill Missing LTM`);
  console.log(`   User: ${userId}`);
  console.log(`   Personality: ${personalityId}`);
  console.log(`   Dry run: ${dryRun ? 'YES (no changes)' : 'NO (will update)'}\n`);

  // 1. Get user's persona
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      defaultPersonaLink: {
        select: { personaId: true },
      },
    },
  });

  if (!user) {
    console.error('❌ User not found');
    return;
  }

  const personaId = user.defaultPersonaLink?.personaId;
  if (!personaId) {
    console.error('❌ No persona found for user');
    return;
  }

  console.log(`   Persona: ${personaId}\n`);

  // 2. Fetch conversation history from PostgreSQL
  const conversations = await prisma.conversationHistory.findMany({
    where: {
      userId,
      personalityId,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
    },
  });

  console.log(`📊 PostgreSQL conversation_history: ${conversations.length} messages`);

  // 3. Fetch memories from Qdrant
  const collectionName = `persona-${personaId}`;
  let memories = [];

  try {
    const scrollResult = await qdrant.scroll(collectionName, {
      filter: {
        must: [
          {
            key: 'personalityId',
            match: { value: personalityId },
          },
        ],
      },
      limit: 10000,
      with_payload: true,
      with_vector: false,
    });

    memories = scrollResult.points;
    console.log(`💾 Qdrant memories: ${memories.length} stored\n`);
  } catch (error) {
    if (error.status === 404) {
      console.log(`⚠️  No Qdrant collection found for persona ${personaId}\n`);
    } else {
      throw error;
    }
  }

  // 4. Group conversations into pairs (user + assistant)
  const conversationPairs = [];
  for (let i = 0; i < conversations.length - 1; i++) {
    const userMsg = conversations[i];
    const assistantMsg = conversations[i + 1];

    if (userMsg.role === 'user' && assistantMsg.role === 'assistant') {
      conversationPairs.push({
        userMessage: userMsg,
        assistantMessage: assistantMsg,
        timestamp: assistantMsg.createdAt,
      });
      i++; // Skip the assistant message in next iteration
    }
  }

  console.log(`💬 Conversation pairs (user+assistant): ${conversationPairs.length}`);

  // 5. Match conversation pairs with Qdrant memories by timestamp
  const memoryTimestamps = memories.map(m => m.payload.createdAt);
  const TOLERANCE_MS = 5000; // 5 seconds

  const missing = conversationPairs.filter(pair => {
    const pairTime = pair.timestamp.getTime();
    const hasMatch = memoryTimestamps.some(memTime => Math.abs(memTime - pairTime) <= TOLERANCE_MS);
    return !hasMatch;
  });

  // 6. Report results
  console.log(`\n📈 Coverage Analysis:`);
  console.log(`   Total conversation pairs: ${conversationPairs.length}`);
  console.log(`   Stored in LTM: ${conversationPairs.length - missing.length}`);
  console.log(`   Missing from LTM: ${missing.length}`);

  if (missing.length === 0) {
    console.log(`   Coverage: 100% ✅`);
    console.log('\n✅ No backfill needed!');
    return;
  }

  const coveragePercent = (
    ((conversationPairs.length - missing.length) / conversationPairs.length) *
    100
  ).toFixed(1);
  console.log(`   Coverage: ${coveragePercent}%`);

  console.log(`\n🔧 Backfilling ${missing.length} missing conversations...\n`);

  let successCount = 0;
  let failCount = 0;

  // Get personality info for metadata
  const personality = await prisma.personality.findUnique({
    where: { id: personalityId },
    select: { name: true },
  });

  for (const pair of missing) {
    const { userMessage, assistantMessage, timestamp } = pair;

    console.log(`\n🔸 Backfilling conversation from ${timestamp.toISOString()}`);
    console.log(`   User: ${userMessage.content.substring(0, 40)}...`);
    console.log(`   Bot:  ${assistantMessage.content.substring(0, 40)}...`);

    if (dryRun) {
      console.log(`   [DRY RUN] Would store to Qdrant`);
      continue;
    }

    try {
      // Reconstruct the interaction text (same format as ConversationalRAGService)
      const interactionText = `User (${userId}): ${userMessage.content}\n${personality.name}: ${assistantMessage.content}`;

      // Generate embedding
      const embedding = await embeddings.embedQuery(interactionText);

      // Prepare metadata (same structure as ConversationalRAGService)
      const metadata = {
        personaId,
        personalityId,
        personalityName: personality.name,
        sessionId: undefined,
        canonScope: 'personal',
        timestamp: timestamp.getTime(),
        summaryType: 'conversation',
        contextType: 'channel', // Assume channel since we don't have the info
        createdAt: timestamp.getTime(), // For audit script matching
      };

      // Store in Qdrant
      await qdrant.upsert(collectionName, {
        wait: true,
        points: [
          {
            id: assistantMessage.id, // Use conversation_history ID
            vector: embedding,
            payload: {
              text: interactionText,
              ...metadata,
            },
          },
        ],
      });

      console.log(`   ✅ Successfully stored to Qdrant`);
      successCount++;
    } catch (error) {
      console.error(`   ❌ Failed to store: ${error.message}`);
      failCount++;
    }
  }

  console.log(`\n📈 Backfill Results:`);
  console.log(`   ✅ Successful: ${successCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log(`   📊 Total processed: ${successCount + failCount}`);
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);
  const userId = args[0];
  const personalityId = args[1];
  const dryRun = args.includes('--dry-run');

  if (!userId || !personalityId || args.includes('--help') || args.includes('-h')) {
    console.error('Usage: node backfill-missing-ltm.cjs <userId> <personalityId> [--dry-run]');
    console.error('');
    console.error('Options:');
    console.error('  --dry-run  Show what would be done without making changes');
    console.error('');
    console.error('Example:');
    console.error(
      '  node backfill-missing-ltm.cjs e64fcc09-e4db-5902-b1c9-5750141e3bf2 c296b337-4e67-5337-99a3-4ca105cbbd68'
    );
    console.error('  node backfill-missing-ltm.cjs <userId> <personalityId> --dry-run');
    process.exit(1);
  }

  try {
    await backfillMissingLTM(userId, personalityId, dryRun);
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = { backfillMissingLTM };
