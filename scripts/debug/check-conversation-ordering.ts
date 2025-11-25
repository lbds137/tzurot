#!/usr/bin/env tsx
/**
 * Check for ordering issues in conversation_history
 */

import { getPrismaClient } from '@tzurot/common-types';

const prisma = getPrismaClient();

async function main() {
  console.log('Checking conversation history ordering...\n');

  // Get total counts
  const totalCount = await prisma.conversationHistory.count();
  const userCount = await prisma.conversationHistory.count({ where: { role: 'user' } });
  const assistantCount = await prisma.conversationHistory.count({ where: { role: 'assistant' } });

  console.log('=== Message Counts ===');
  console.log(`Total messages: ${totalCount}`);
  console.log(`User messages: ${userCount}`);
  console.log(`Assistant messages: ${assistantCount}`);
  console.log();

  // Sample some conversations to check ordering
  const channels = await prisma.conversationHistory.findMany({
    select: { channelId: true, personalityId: true },
    distinct: ['channelId', 'personalityId'],
    take: 5,
  });

  console.log('=== Sampling 5 conversations for ordering ===');
  let totalInversions = 0;

  for (const { channelId, personalityId } of channels) {
    const messages = await prisma.conversationHistory.findMany({
      where: { channelId, personalityId },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        createdAt: true,
        content: true,
      },
      take: 20, // Just sample the first 20
    });

    console.log(
      `\nChannel ${channelId.slice(0, 8)}... / Personality ${personalityId.slice(0, 8)}...`
    );
    console.log(`Messages: ${messages.length}`);

    let inversions = 0;
    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1];
      const curr = messages[i];

      // Check if assistant comes immediately before user (inversion)
      if (prev.role === 'assistant' && curr.role === 'user') {
        inversions++;
        console.log(`  ⚠️  Inversion at index ${i}: assistant -> user`);
        console.log(`      ${prev.createdAt.toISOString()}: ${prev.content.slice(0, 50)}...`);
        console.log(`      ${curr.createdAt.toISOString()}: ${curr.content.slice(0, 50)}...`);
      }
    }

    if (inversions === 0) {
      console.log(`  ✅ No inversions found`);
    } else {
      console.log(`  Found ${inversions} inversions`);
      totalInversions += inversions;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total inversions in sampled conversations: ${totalInversions}`);

  if (totalInversions > 0) {
    console.log('\n💡 Solution: The memory rebuild script will handle this by:');
    console.log('   1. Grouping messages by channel/personality/persona');
    console.log('   2. Sorting by created_at');
    console.log('   3. Pairing user->assistant in sequence');
    console.log('   4. Skipping malformed pairs');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
