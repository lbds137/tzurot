#!/usr/bin/env tsx
/**
 * One-time migration: Populate avatarData field from existing avatar files
 *
 * This script reads avatar images from avatars-to-migrate/ directory,
 * converts them to base64, and stores them in the personalities table.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

// Map of personality slugs to avatar filenames
const AVATAR_MAPPINGS = [
  {
    slug: 'lilith-tzel-shani',
    filename: 'lilith-tzel-shani.png',
  },
  {
    slug: 'cold-kerach-batuach',
    filename: 'cold-kerach-batuach.png',
  },
  {
    slug: 'ha-shem-keev-ima',
    filename: 'ha-shem-keev-ima.png',
  },
  {
    slug: 'emily-tzudad-seraph-ditza',
    filename: 'emily-tzudad-seraph-ditza.png',
  },
  {
    slug: 'lucifer-kochav-shenafal',
    filename: 'lucifer-kochav-shenafal.png',
  },
];

async function populateAvatarData() {
  console.log('🖼️  Populating avatar data from files...\n');

  for (const mapping of AVATAR_MAPPINGS) {
    try {
      // Check if personality exists
      const personality = await prisma.personality.findUnique({
        where: { slug: mapping.slug },
      });

      if (!personality) {
        console.log(`⚠️  Personality not found: ${mapping.slug} - skipping`);
        continue;
      }

      // Check if avatarData already populated
      if (personality.avatarData) {
        console.log(`✅ Avatar data already exists for: ${mapping.slug} - skipping`);
        continue;
      }

      // Read avatar file
      const avatarPath = join(
        __dirname,
        '..',
        'services',
        'api-gateway',
        'avatars-to-migrate',
        mapping.filename
      );

      let avatarBuffer: Buffer;
      try {
        avatarBuffer = await readFile(avatarPath);
      } catch (error) {
        console.log(`❌ Failed to read avatar file: ${mapping.filename}`);
        console.log(`   Path: ${avatarPath}`);
        continue;
      }

      // Convert to base64
      const base64Data = avatarBuffer.toString('base64');
      const sizeKB = (base64Data.length / 1024).toFixed(2);

      console.log(`📦 Processing: ${mapping.slug}`);
      console.log(`   File: ${mapping.filename}`);
      console.log(`   Size: ${sizeKB} KB (base64)`);

      // Update personality with base64 data
      await prisma.personality.update({
        where: { slug: mapping.slug },
        data: { avatarData: base64Data },
      });

      console.log(`   ✅ Stored in database\n`);
    } catch (error) {
      console.error(`❌ Error processing ${mapping.slug}:`, error);
    }
  }

  console.log('✨ Avatar data population complete!');
}

async function main() {
  try {
    await populateAvatarData();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
