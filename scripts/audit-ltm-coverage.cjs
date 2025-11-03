#!/usr/bin/env node
/**
 * Audit LTM Coverage
 * Compares conversation_history (PostgreSQL) against Qdrant memories
 * to identify which conversations didn't make it to long-term memory
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { QdrantClient } = require('@qdrant/js-client-rest');

const prisma = new PrismaClient();
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function auditLTMCoverage(userId, personalityId) {
  console.log(`\n🔍 Auditing LTM Coverage`);
  console.log(`   User: ${userId}`);
  console.log(`   Personality: ${personalityId}\n`);

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
        timestamp: assistantMsg.createdAt, // Use assistant message timestamp for matching
      });
      i++; // Skip the assistant message in next iteration
    }
  }

  console.log(`💬 Conversation pairs (user+assistant): ${conversationPairs.length}`);

  // 5. Match conversation pairs with Qdrant memories by timestamp
  // Note: Timestamps won't match exactly because:
  //   - conversation_history.createdAt = when message was saved to PostgreSQL
  //   - memory.createdAt = Date.now() when storeInteraction() was called
  // These can be milliseconds or seconds apart, so we use a ±5 second tolerance

  const memoryTimestamps = memories.map(m => m.payload.createdAt);
  const TOLERANCE_MS = 5000; // 5 seconds

  const missing = conversationPairs.filter(pair => {
    const pairTime = pair.timestamp.getTime();

    // Check if any memory timestamp is within tolerance
    const hasMatch = memoryTimestamps.some(memTime => Math.abs(memTime - pairTime) <= TOLERANCE_MS);

    return !hasMatch;
  });

  // 6. Report results
  console.log(`\n📈 Coverage Analysis:`);
  console.log(`   Total conversation pairs: ${conversationPairs.length}`);
  console.log(`   Stored in LTM: ${conversationPairs.length - missing.length}`);
  console.log(`   Missing from LTM: ${missing.length}`);

  if (missing.length > 0) {
    const coveragePercent = (
      ((conversationPairs.length - missing.length) / conversationPairs.length) *
      100
    ).toFixed(1);
    console.log(`   Coverage: ${coveragePercent}%`);
  } else {
    console.log(`   Coverage: 100% ✅`);
  }

  if (missing.length > 0) {
    console.log(`\n❌ Missing Conversations (${missing.length}):`);
    console.log('='.repeat(80));

    missing.slice(0, 20).forEach((pair, idx) => {
      console.log(`\n${idx + 1}. ${pair.timestamp.toISOString()}`);
      console.log(`   User: ${pair.userMessage.content.substring(0, 60)}...`);
      console.log(`   Bot:  ${pair.assistantMessage.content.substring(0, 60)}...`);
    });

    if (missing.length > 20) {
      console.log(`\n   ... and ${missing.length - 20} more`);
    }
  }

  return {
    total: conversationPairs.length,
    stored: conversationPairs.length - missing.length,
    missing: missing.length,
    missingPairs: missing,
  };
}

// CLI usage
async function main() {
  const userId = process.argv[2];
  const personalityId = process.argv[3];

  if (!userId || !personalityId) {
    console.error('Usage: node audit-ltm-coverage.cjs <userId> <personalityId>');
    console.error('');
    console.error('Example:');
    console.error(
      '  node audit-ltm-coverage.cjs e64fcc09-e4db-5902-b1c9-5750141e3bf2 c296b337-4e67-5337-99a3-4ca105cbbd68'
    );
    process.exit(1);
  }

  try {
    await auditLTMCoverage(userId, personalityId);
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

module.exports = { auditLTMCoverage };
