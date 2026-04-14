#!/usr/bin/env tsx
/**
 * Debug helper: inspect user/persona/history state for a given UUID.
 *
 * The input UUID can refer to either a User.id or a Persona.id — the script
 * probes both, then dumps the full provisioning state (default persona, all
 * owned personas, conversation history count + recent sample).
 *
 * Originally written for the 2026-04-14 persona-snowflake-name incident;
 * generic enough to reuse for future identity-pipeline debugging.
 *
 * Usage:
 *   pnpm ops run --env prod --force tsx scripts/debug/check-user-persona-state.ts <uuid>
 */

import { getPrismaClient } from '@tzurot/common-types';

// UUID comes in as a positional CLI argument. argv[0]=node, argv[1]=script,
// argv[2]=uuid. Using argv (not process.env) because CodeQL's sensitive-data
// heuristic flags process.env logging; a user UUID is not actually sensitive,
// but this sidesteps the alert AND is ergonomically simpler.
const targetUuid = process.argv[2] ?? '';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_PATTERN.test(targetUuid)) {
  console.error(
    'ERROR: a valid UUID argument is required.\n' +
      'Example: pnpm ops run --env prod --force tsx scripts/debug/check-user-persona-state.ts 9ef82999-bfd8-5831-8156-e263b45dab2d'
  );
  process.exit(1);
}

const prisma = getPrismaClient();

async function main(): Promise<void> {
  console.log(`\n=== Investigating UUID: ${targetUuid} ===\n`);

  // 1. Is this a User.id?
  const userById = await prisma.user.findUnique({
    where: { id: targetUuid },
    select: {
      id: true,
      discordId: true,
      username: true,
      defaultPersonaId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (userById !== null) {
    console.log('✓ Found as User.id');
    console.log(`  discordId:        ${userById.discordId}`);
    console.log(`  username:         ${JSON.stringify(userById.username)}`);
    console.log(`  defaultPersonaId: ${userById.defaultPersonaId ?? '(null)'}`);
    console.log(`  createdAt:        ${userById.createdAt.toISOString()}`);
    console.log(`  updatedAt:        ${userById.updatedAt.toISOString()}`);
  } else {
    console.log('✗ NOT a User.id');
  }

  // 2. Is this a Persona.id?
  const personaById = await prisma.persona.findUnique({
    where: { id: targetUuid },
    select: {
      id: true,
      name: true,
      preferredName: true,
      ownerId: true,
      createdAt: true,
    },
  });

  if (personaById !== null) {
    console.log('\n✓ Found as Persona.id');
    console.log(`  name:          ${JSON.stringify(personaById.name)}`);
    console.log(`  preferredName: ${JSON.stringify(personaById.preferredName)}`);
    console.log(`  ownerId:       ${personaById.ownerId}`);
    console.log(`  createdAt:     ${personaById.createdAt.toISOString()}`);

    const owner = await prisma.user.findUnique({
      where: { id: personaById.ownerId },
      select: { discordId: true, username: true, defaultPersonaId: true },
    });
    if (owner !== null) {
      console.log(`  owner.discordId:        ${owner.discordId}`);
      console.log(`  owner.username:         ${JSON.stringify(owner.username)}`);
      console.log(`  owner.defaultPersonaId: ${owner.defaultPersonaId ?? '(null)'}`);
      console.log(
        `  is owner's default?     ${owner.defaultPersonaId === personaById.id ? 'YES' : 'NO'}`
      );
    } else {
      console.log(`  ⚠️  owner User record NOT FOUND`);
    }
  } else {
    console.log('\n✗ NOT a Persona.id');
  }

  // 3. If we found a user (directly or via persona owner), check their personas + conversation history
  const userId = userById?.id ?? personaById?.ownerId ?? null;
  if (userId !== null) {
    console.log(`\n=== Detailed state for user ${userId} ===\n`);

    const allPersonas = await prisma.persona.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true, preferredName: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`All personas owned by this user: ${allPersonas.length}`);
    for (const p of allPersonas) {
      console.log(
        `  - ${p.id} | name=${JSON.stringify(p.name)} | preferredName=${JSON.stringify(p.preferredName)} | created=${p.createdAt.toISOString()}`
      );
    }

    // ConversationHistory joins via Persona.ownerId (no direct userId FK)
    const personaIds = allPersonas.map(p => p.id);
    const convoHistoryCount = await prisma.conversationHistory.count({
      where: { personaId: { in: personaIds } },
    });
    console.log(`\nConversationHistory rows via owned personas: ${convoHistoryCount}`);

    if (convoHistoryCount > 0) {
      const recent = await prisma.conversationHistory.findMany({
        where: { personaId: { in: personaIds } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          role: true,
          personaId: true,
          channelId: true,
          createdAt: true,
          content: true,
        },
      });
      console.log(`\nMost recent 5 messages:`);
      for (const m of recent) {
        const preview = m.content.substring(0, 80).replace(/\n/g, ' ');
        console.log(
          `  [${m.createdAt.toISOString()}] role=${m.role} personaId=${m.personaId ?? '(null)'} channel=${m.channelId} content="${preview}"`
        );
      }
    }
  }

  console.log('\n=== Done ===\n');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
