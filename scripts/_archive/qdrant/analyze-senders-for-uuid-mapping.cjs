#!/usr/bin/env node
/**
 * Analyze `senders` field in Qdrant memories to identify UUID co-occurrence patterns
 *
 * This helps map old shapes.inc UUIDs to current Postgres users by finding:
 * - Which UUIDs frequently appear together (likely friends/regular chat partners)
 * - Which UUIDs are the same person across multiple personas
 *
 * Usage: node scripts/analyze-senders-for-uuid-mapping.cjs
 */

require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const { PrismaClient } = require('@prisma/client');

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const prisma = new PrismaClient();

async function analyzeSenders() {
  console.log('🔍 Analyzing sender co-occurrence patterns in Qdrant memories\n');
  console.log('='.repeat(80));

  // Get current Postgres users for reference
  const pgUsers = await prisma.user.findMany({
    select: { id: true, username: true, discordId: true },
  });

  const knownUsers = new Map(pgUsers.map(u => [u.id, u.username]));
  console.log('\n📋 Known Users (Current Postgres):');
  for (const u of pgUsers) {
    console.log(`  ${u.username}: ${u.id} (Discord: ${u.discordId})`);
  }

  // Track sender statistics
  const senderStats = new Map(); // userId → { count, coOccurs: Map<userId, count> }
  const collectionName = 'personality-c296b337-4e67-5337-99a3-4ca105cbbd68';

  console.log('\n📦 Scanning Qdrant collection...');

  let offset = null;
  let totalPoints = 0;
  let groupConversations = 0;

  while (true) {
    const response = await qdrant.scroll(collectionName, {
      limit: 100,
      offset: offset,
      with_payload: true,
      with_vector: false,
    });

    for (const point of response.points) {
      totalPoints++;
      const senders = point.payload.senders || point.payload.metadata?.senders;

      if (!senders || !Array.isArray(senders)) continue;
      if (senders.length < 2) continue; // Skip solo conversations

      groupConversations++;

      // Track each sender
      for (const senderId of senders) {
        if (!senderStats.has(senderId)) {
          senderStats.set(senderId, {
            count: 0,
            coOccurs: new Map(),
          });
        }

        const stats = senderStats.get(senderId);
        stats.count++;

        // Track co-occurrence with other senders
        for (const otherId of senders) {
          if (otherId === senderId) continue;

          if (!stats.coOccurs.has(otherId)) {
            stats.coOccurs.set(otherId, 0);
          }
          stats.coOccurs.set(otherId, stats.coOccurs.get(otherId) + 1);
        }
      }
    }

    offset = response.next_page_offset;
    if (!offset) break;
  }

  console.log(`  Scanned ${totalPoints} points`);
  console.log(`  Found ${groupConversations} group conversations`);
  console.log(`  Unique senders: ${senderStats.size}`);

  // Analyze patterns
  console.log('\n' + '='.repeat(80));
  console.log('📊 Sender Co-occurrence Analysis');
  console.log('='.repeat(80));

  // For each known user, find their likely old UUID
  for (const [currentId, username] of knownUsers) {
    console.log(`\n👤 ${username} (${currentId}):`);

    // Get their co-occurrence stats
    const currentStats = senderStats.get(currentId);

    if (!currentStats) {
      console.log('  ❌ No memories found with this UUID');
      continue;
    }

    console.log(`  ✓ Appears in ${currentStats.count} group conversations`);
    console.log(`  Top co-occurring users:`);

    // Sort by co-occurrence count
    const coOccurs = Array.from(currentStats.coOccurs.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    for (const [otherId, count] of coOccurs) {
      const otherName = knownUsers.get(otherId) || '(unknown)';
      const status = knownUsers.has(otherId) ? '✓' : '✗';
      console.log(
        `    ${status} ${otherId}: ${count} shared conversations ${otherName !== '(unknown)' ? `(${otherName})` : ''}`
      );
    }
  }

  // Find potential old UUIDs that frequently co-occur with known users
  console.log('\n' + '='.repeat(80));
  console.log('🔗 Potential Old UUID Mappings');
  console.log('='.repeat(80));
  console.log('\nOrphaned UUIDs that frequently appear with known users:\n');

  const orphanedWithConnections = [];

  for (const [orphanId, stats] of senderStats) {
    if (knownUsers.has(orphanId)) continue; // Skip known users

    // Count connections to known users
    let knownConnections = 0;
    const connections = [];

    for (const [otherId, count] of stats.coOccurs) {
      if (knownUsers.has(otherId)) {
        knownConnections += count;
        connections.push({ userId: otherId, username: knownUsers.get(otherId), count });
      }
    }

    if (knownConnections > 0) {
      orphanedWithConnections.push({
        orphanId,
        totalConversations: stats.count,
        knownConnections,
        connections: connections.sort((a, b) => b.count - a.count),
      });
    }
  }

  // Sort by number of connections to known users
  orphanedWithConnections.sort((a, b) => b.knownConnections - a.knownConnections);

  for (const item of orphanedWithConnections.slice(0, 20)) {
    console.log(`${item.orphanId}:`);
    console.log(`  Total group conversations: ${item.totalConversations}`);
    console.log(`  Shared conversations with known users: ${item.knownConnections}`);
    console.log(`  Most frequent partners:`);
    for (const conn of item.connections.slice(0, 5)) {
      console.log(`    - ${conn.username}: ${conn.count} conversations`);
    }
    console.log('');
  }

  // Generate suggested mappings
  console.log('='.repeat(80));
  console.log('💡 Suggested Investigation Steps');
  console.log('='.repeat(80));
  console.log('\n1. Check top orphaned UUIDs that co-occur with your current users');
  console.log('2. Search their memories for identifying content:');
  console.log('   node scripts/find-user-memories.cjs "<keyword>"');
  console.log('\n3. Add confirmed mappings to scripts/uuid-mappings.json');
  console.log('\n4. Current known mappings:');
  console.log('   82ea754e-c3fb-467a-8662-8bc30791b4fe → fennarin (Snail → Fennarin)');

  await prisma.$disconnect();
}

analyzeSenders().catch(console.error);
