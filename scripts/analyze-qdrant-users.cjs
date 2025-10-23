#!/usr/bin/env node
/**
 * Analyze userIds in Qdrant vs Postgres
 * Identifies orphaned memories from old shapes.inc imports
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { QdrantClient } = require('@qdrant/js-client-rest');

const prisma = new PrismaClient();
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function main() {
  console.log('Analyzing Qdrant userIds vs Postgres users...\n');

  // Get all Postgres users
  const pgUsers = await prisma.user.findMany({
    select: { id: true, username: true, discordId: true }
  });

  const pgUserIds = new Set(pgUsers.map(u => u.id));
  console.log(`Postgres users (${pgUsers.length}):`);
  for (const u of pgUsers) {
    console.log(`  ${u.username}: ${u.id}`);
  }

  // Scan Qdrant for unique userIds
  console.log('\nScanning Qdrant collection...');
  const collectionName = 'personality-c296b337-4e67-5337-99a3-4ca105cbbd68';
  const qdrantUserIds = new Set();

  let offset = null;
  let totalPoints = 0;

  while (true) {
    const response = await qdrant.scroll(collectionName, {
      limit: 100,
      offset: offset,
      with_payload: true,
      with_vector: false,
    });

    for (const point of response.points) {
      totalPoints++;
      if (point.payload.userId) {
        qdrantUserIds.add(point.payload.userId);
      }
    }

    offset = response.next_page_offset;
    if (!offset) break;
  }

  console.log(`\nQdrant unique userIds (${qdrantUserIds.size}):`);
  for (const uid of Array.from(qdrantUserIds).sort()) {
    const inPostgres = pgUserIds.has(uid);
    const user = pgUsers.find(u => u.id === uid);
    console.log(`  ${uid} ${inPostgres ? '✓' : '✗'} ${user ? `(${user.username})` : '(NOT IN POSTGRES)'}`);
  }

  // Find orphaned memories
  const orphanedIds = Array.from(qdrantUserIds).filter(id => !pgUserIds.has(id));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total Qdrant points: ${totalPoints}`);
  console.log(`Unique userIds: ${qdrantUserIds.size}`);
  console.log(`In Postgres: ${qdrantUserIds.size - orphanedIds.length}`);
  console.log(`NOT in Postgres (orphaned): ${orphanedIds.length}`);

  if (orphanedIds.length > 0) {
    console.log(`\nOrphaned userIds:`);
    for (const id of orphanedIds) {
      console.log(`  ${id}`);
    }

    console.log(`\n⚠️  These memories cannot be migrated without matching Postgres users.`);
    console.log(`   Options:`);
    console.log(`   1. Create users in Postgres for these IDs`);
    console.log(`   2. Skip them (they'll be orphaned in Qdrant)`);
    console.log(`   3. Map them to existing users if you know the mapping`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
