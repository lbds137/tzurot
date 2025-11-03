#!/usr/bin/env tsx

/**
 * Data Migration: Populate personaId in conversation_history
 *
 * This script migrates existing conversation_history records from userId-based
 * to personaId-based storage. This aligns STM (PostgreSQL) with LTM (Qdrant).
 *
 * For each conversation_history row with null personaId:
 * 1. Check user_personality_configs for personality-specific persona override
 * 2. Fall back to user_default_personas for user's default persona
 * 3. If no persona exists, create a default persona for the user
 * 4. Update the conversation_history row with the resolved personaId
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MigrationStats {
  total: number;
  migrated: number;
  skipped: number;
  errors: number;
  createdPersonas: number;
}

async function getOrCreatePersonaForUser(
  userId: string,
  personalityId: string,
  username: string
): Promise<string | null> {
  try {
    // 1. Check for personality-specific persona override
    const userConfig = await prisma.userPersonalityConfig.findUnique({
      where: {
        userId_personalityId: {
          userId,
          personalityId,
        },
      },
      select: {
        personaId: true,
      },
    });

    if (userConfig?.personaId) {
      console.log(`  ✓ Found personality-specific persona: ${userConfig.personaId}`);
      return userConfig.personaId;
    }

    // 2. Check for user's default persona
    const defaultPersona = await prisma.userDefaultPersona.findUnique({
      where: {
        userId,
      },
      select: {
        personaId: true,
      },
    });

    if (defaultPersona?.personaId) {
      console.log(`  ✓ Found default persona: ${defaultPersona.personaId}`);
      return defaultPersona.personaId;
    }

    // 3. No persona exists - create a default one
    console.log(`  ⚠ No persona found for user ${userId}, creating default persona...`);

    const newPersona = await prisma.persona.create({
      data: {
        name: `${username}'s Persona`,
        description: 'Auto-created during conversation history migration',
        content: `I am ${username}.`,
        ownerId: userId,
      },
    });

    // Set as default persona for this user
    await prisma.userDefaultPersona.create({
      data: {
        userId,
        personaId: newPersona.id,
      },
    });

    console.log(`  ✓ Created new default persona: ${newPersona.id}`);
    return newPersona.id;
  } catch (error) {
    console.error(`  ✗ Error resolving persona for user ${userId}:`, error);
    return null;
  }
}

async function migrateConversationHistory(): Promise<MigrationStats> {
  const stats: MigrationStats = {
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
    createdPersonas: 0,
  };

  try {
    // Get all conversation_history rows with null personaId
    const conversations = await prisma.conversationHistory.findMany({
      where: {
        personaId: null,
      },
      select: {
        id: true,
        userId: true,
        personalityId: true,
        channelId: true,
        createdAt: true,
        user: {
          select: {
            username: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    stats.total = conversations.length;

    console.log(`\nFound ${stats.total} conversation_history rows to migrate\n`);

    if (stats.total === 0) {
      console.log('✓ No migration needed - all rows already have personaId\n');
      return stats;
    }

    // Group conversations by userId + personalityId to avoid redundant lookups
    const userPersonalityGroups = new Map<string, typeof conversations>();

    for (const conv of conversations) {
      const key = `${conv.userId}:${conv.personalityId}`;
      if (!userPersonalityGroups.has(key)) {
        userPersonalityGroups.set(key, []);
      }
      userPersonalityGroups.get(key)!.push(conv);
    }

    console.log(
      `Processing ${userPersonalityGroups.size} unique user-personality combinations...\n`
    );

    let processedCount = 0;

    for (const [key, convs] of userPersonalityGroups.entries()) {
      const [userId, personalityId] = key.split(':');
      const username = convs[0].user.username;

      console.log(
        `[${++processedCount}/${userPersonalityGroups.size}] Processing ${username} (${userId.substring(0, 8)}...) with personality ${personalityId.substring(0, 8)}...`
      );
      console.log(`  Found ${convs.length} conversation messages`);

      // Get or create persona for this user+personality combo
      const personaId = await getOrCreatePersonaForUser(userId, personalityId, username);

      if (!personaId) {
        console.log(`  ✗ Failed to resolve personaId - skipping ${convs.length} messages\n`);
        stats.errors += convs.length;
        continue;
      }

      // Update all conversations for this user+personality combo
      try {
        const result = await prisma.conversationHistory.updateMany({
          where: {
            id: {
              in: convs.map(c => c.id),
            },
          },
          data: {
            personaId,
          },
        });

        stats.migrated += result.count;
        console.log(`  ✓ Updated ${result.count} messages\n`);
      } catch (error) {
        console.error(`  ✗ Failed to update conversations:`, error);
        stats.errors += convs.length;
      }
    }
  } catch (error) {
    console.error('Fatal error during migration:', error);
    throw error;
  }

  return stats;
}

async function verifyMigration(): Promise<void> {
  const remaining = await prisma.conversationHistory.count({
    where: {
      personaId: null,
    },
  });

  if (remaining > 0) {
    console.log(`⚠ WARNING: ${remaining} conversation_history rows still have null personaId`);
  } else {
    console.log('✓ All conversation_history rows have personaId populated');
  }

  const total = await prisma.conversationHistory.count();
  console.log(`  Total conversation_history rows: ${total}`);
}

async function main() {
  console.log('========================================');
  console.log('Conversation History → Persona ID Migration');
  console.log('========================================\n');

  try {
    // Run migration
    const stats = await migrateConversationHistory();

    // Print summary
    console.log('\n========================================');
    console.log('Migration Summary');
    console.log('========================================');
    console.log(`Total rows processed:    ${stats.total}`);
    console.log(`Successfully migrated:   ${stats.migrated}`);
    console.log(`Skipped:                 ${stats.skipped}`);
    console.log(`Errors:                  ${stats.errors}`);
    console.log(`New personas created:    ${stats.createdPersonas}`);
    console.log('========================================\n');

    // Verify migration
    await verifyMigration();

    console.log('\n✓ Migration complete!');
  } catch (error) {
    console.error('\n✗ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
