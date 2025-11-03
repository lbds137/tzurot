#!/usr/bin/env tsx
/**
 * Fix Lilith Avatar
 *
 * Downloads Lilith's avatar from shapes.inc (if still available)
 * or uses fallback, then updates database.
 */

import { PrismaClient } from '@prisma/client';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const prisma = new PrismaClient();

const SHAPES_AVATAR_URL =
  'https://files.shapes.inc/api/files/avatar_1fed013b-053a-4bc8-bc09-7da5c44297d6.png';
const LOCAL_AVATAR_PATH = '/data/avatars/lilith-tzel-shani.png';
const PUBLIC_AVATAR_URL =
  'https://api-gateway-development-83e8.up.railway.app/avatars/lilith-tzel-shani.png';

async function downloadAvatar(): Promise<boolean> {
  try {
    console.log('Attempting to download avatar from shapes.inc...');

    const response = await fetch(SHAPES_AVATAR_URL, {
      headers: {
        'User-Agent': 'Tzurot/3.0 (Avatar Migration)',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.log(`✗ Download failed: HTTP ${response.status}`);
      return false;
    }

    const buffer = await response.arrayBuffer();

    // Ensure directory exists
    await mkdir('/data/avatars', { recursive: true });

    // Write file
    await writeFile(LOCAL_AVATAR_PATH, Buffer.from(buffer));

    console.log(`✓ Downloaded avatar (${buffer.byteLength} bytes)`);
    return true;
  } catch (error) {
    console.log(`✗ Download error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function updateDatabase(): Promise<void> {
  console.log('\nUpdating database...');

  const result = await prisma.personality.update({
    where: { name: 'Lilith' },
    data: { avatar_url: PUBLIC_AVATAR_URL },
  });

  console.log(`✓ Updated personality: ${result.name}`);
  console.log(`  Old URL: ${result.avatar_url}`);
  console.log(`  New URL: ${PUBLIC_AVATAR_URL}`);
}

async function main() {
  console.log('🔧 Fixing Lilith Avatar\n');
  console.log('═'.repeat(60));

  // Try to download avatar
  const downloaded = await downloadAvatar();

  if (!downloaded) {
    console.log('\n⚠️  Could not download avatar from shapes.inc');
    console.log('   You will need to manually upload the avatar from:');
    console.log('   tzurot-legacy/data/avatars/images/lilith-tzel-shani-343f3d9e.png');
    console.log('   to Railway volume: /data/avatars/lilith-tzel-shani.png');
    console.log('\n   Continuing with database update anyway...');
  }

  // Update database regardless
  await updateDatabase();

  console.log('\n═'.repeat(60));
  console.log('✅ Done!\n');
  console.log('Verify avatar at:');
  console.log(`  ${PUBLIC_AVATAR_URL}`);

  await prisma.$disconnect();
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
