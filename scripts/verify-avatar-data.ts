#!/usr/bin/env tsx
/**
 * Verification script: Check that avatarData was populated in database
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyAvatarData() {
  console.log('🔍 Verifying avatar data in database...\n');

  const personalities = await prisma.personality.findMany({
    where: {
      avatarData: { not: null },
    },
    select: {
      slug: true,
      avatarData: true,
    },
  });

  console.log(`Found ${personalities.length} personalities with avatar data:\n`);

  for (const p of personalities) {
    const sizeKB = (p.avatarData!.length / 1024).toFixed(2);
    console.log(`✅ ${p.slug}: ${sizeKB} KB (base64)`);
  }

  if (personalities.length === 0) {
    console.log('⚠️  No personalities found with avatar data!');
  }
}

async function main() {
  try {
    await verifyAvatarData();
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
