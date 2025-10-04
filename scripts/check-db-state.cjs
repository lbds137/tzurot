#!/usr/bin/env node
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('\n=== PERSONALITIES ===\n');
  const personalities = await prisma.personality.findMany({
    include: {
      systemPrompt: true
    }
  });

  for (const p of personalities) {
    console.log(`${p.name} (${p.id})`);
    console.log(`  System Prompt: ${p.systemPrompt?.content?.substring(0, 100)}...`);
    console.log('');
  }

  console.log('\n=== PERSONAS (User Context) ===\n');
  const personas = await prisma.persona.findMany({
    include: {
      owner: true
    }
  });

  for (const p of personas) {
    console.log(`${p.name} (${p.id})`);
    console.log(`  Owner: ${p.owner?.username || 'None'}`);
    console.log(`  Content: ${p.content.substring(0, 100)}...`);
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
