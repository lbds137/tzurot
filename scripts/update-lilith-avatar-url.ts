#!/usr/bin/env tsx
/**
 * Update Lilith Avatar URL in Database
 *
 * Updates the avatar_url in the personalities table to point to self-hosted avatar.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const AVATAR_URL = process.env.API_GATEWAY_URL
  ? `${process.env.API_GATEWAY_URL}/avatars/lilith-tzel-shani.png`
  : 'https://api-gateway-development-83e8.up.railway.app/avatars/lilith-tzel-shani.png';

async function main() {
  console.log('🔧 Updating Lilith Avatar URL\n');
  console.log('═'.repeat(60));

  const result = await prisma.personality.update({
    where: { name: 'Lilith' },
    data: { avatar_url: AVATAR_URL },
    select: {
      id: true,
      name: true,
      avatar_url: true
    }
  });

  console.log('✓ Updated personality:', result.name);
  console.log('  New URL:', result.avatar_url);
  console.log('\n═'.repeat(60));
  console.log('✅ Done!\n');

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
