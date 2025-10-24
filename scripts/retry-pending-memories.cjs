#!/usr/bin/env node
/**
 * Retry Pending Memories
 * Processes failed memory storage attempts from pending_memories table
 * and retries storing them to Qdrant
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

async function retryPendingMemories(maxAttempts = 5, dryRun = false) {
  console.log(`\n🔄 Retry Pending Memories`);
  console.log(`   Max attempts: ${maxAttempts}`);
  console.log(`   Dry run: ${dryRun ? 'YES (no changes)' : 'NO (will update)'}\n`);

  try {
    // 1. Fetch all pending memories
    const pendingMemories = await prisma.pendingMemory.findMany({
      where: {
        attempts: {
          lt: maxAttempts
        }
      },
      orderBy: {
        createdAt: 'asc'
      },
      include: {
        conversationHistory: {
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true
          }
        }
      }
    });

    console.log(`📊 Found ${pendingMemories.length} pending memories to retry\n`);

    if (pendingMemories.length === 0) {
      console.log('✅ No pending memories found!');
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const pending of pendingMemories) {
      const { id, personaId, text, metadata, attempts } = pending;

      console.log(`\n🔸 Retry ${id.substring(0, 8)}... (attempt ${attempts + 1}/${maxAttempts})`);
      console.log(`   Persona: ${personaId}`);
      console.log(`   Text: ${text.substring(0, 60)}...`);

      if (dryRun) {
        console.log(`   [DRY RUN] Would retry storing to Qdrant`);
        continue;
      }

      try {
        // 2. Generate embedding for the text
        const embedding = await embeddings.embedQuery(text);

        // 3. Store in Qdrant
        const collectionName = `persona-${personaId}`;

        await qdrant.upsert(collectionName, {
          wait: true,
          points: [
            {
              id: id, // Use pending_memory ID as Qdrant point ID
              vector: embedding,
              payload: {
                text,
                ...metadata
              }
            }
          ]
        });

        console.log(`   ✅ Successfully stored to Qdrant collection: ${collectionName}`);

        // 4. Delete the pending_memory
        await prisma.pendingMemory.delete({
          where: { id }
        });

        console.log(`   🗑️  Deleted pending_memory record`);
        successCount++;

      } catch (error) {
        console.error(`   ❌ Failed to store: ${error.message}`);

        // 5. Update pending_memory with error details
        await prisma.pendingMemory.update({
          where: { id },
          data: {
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
            error: error.message
          }
        });

        console.log(`   📝 Updated pending_memory with error (attempt ${attempts + 1})`);
        failCount++;
      }
    }

    console.log(`\n📈 Results:`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log(`   📊 Total processed: ${successCount + failCount}`);

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);
  const maxAttempts = args.includes('--max-attempts')
    ? parseInt(args[args.indexOf('--max-attempts') + 1])
    : 5;
  const dryRun = args.includes('--dry-run');

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node retry-pending-memories.cjs [options]');
    console.log('');
    console.log('Options:');
    console.log('  --max-attempts <n>  Maximum attempts before giving up (default: 5)');
    console.log('  --dry-run           Show what would be done without making changes');
    console.log('  --help, -h          Show this help message');
    console.log('');
    console.log('Example:');
    console.log('  node retry-pending-memories.cjs');
    console.log('  node retry-pending-memories.cjs --max-attempts 3');
    console.log('  node retry-pending-memories.cjs --dry-run');
    process.exit(0);
  }

  try {
    await retryPendingMemories(maxAttempts, dryRun);
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { retryPendingMemories };
