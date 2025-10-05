require('dotenv/config');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkPersonalities() {
  const personalities = await prisma.personality.findMany({
    select: { id: true, name: true, slug: true }
  });

  console.log('🎭 Personalities in database:\n');
  personalities.forEach(p => {
    console.log(`${p.name} (${p.slug})`);
    console.log(`  ID: ${p.id}`);
    console.log(`  Qdrant collection: personality-${p.id}\n`);
  });

  await prisma.$disconnect();
}

checkPersonalities();
