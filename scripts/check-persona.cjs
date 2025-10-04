#!/usr/bin/env node
/**
 * Check and fix user persona linking
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  // Check users and their personas
  const users = await prisma.user.findMany({
    include: {
      ownedPersonas: true,
      globalPersona: true
    }
  });

  console.log('\n=== Users and Personas ===\n');

  for (const user of users) {
    console.log(`User: ${user.username} (Discord ID: ${user.discordId})`);
    console.log(`  ID: ${user.id}`);
    console.log(`  Global Persona ID: ${user.globalPersonaId || 'NOT SET'}`);

    if (user.ownedPersonas.length > 0) {
      console.log(`  Owned Personas (${user.ownedPersonas.length}):`);
      for (const persona of user.ownedPersonas) {
        console.log(`    - ${persona.name} (${persona.id})`);
        console.log(`      Content: ${persona.content.substring(0, 100)}...`);
      }
    } else {
      console.log(`  No owned personas`);
    }

    console.log('');
  }

  // Check if any persona needs to be linked as global
  const usersNeedingLink = users.filter(u =>
    !u.globalPersonaId && u.ownedPersonas.length > 0
  );

  if (usersNeedingLink.length > 0) {
    console.log('\n=== Users needing persona link ===\n');

    for (const user of usersNeedingLink) {
      const persona = user.ownedPersonas[0]; // Use first persona
      console.log(`Linking ${user.username} -> ${persona.name}`);

      await prisma.user.update({
        where: { id: user.id },
        data: { globalPersonaId: persona.id }
      });

      console.log(`✓ Linked!`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
