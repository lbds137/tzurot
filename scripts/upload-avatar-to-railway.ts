#!/usr/bin/env tsx
/**
 * Upload Avatar to Railway Volume
 *
 * This script uploads a base64-encoded avatar to the Railway /data/avatars volume.
 * Usage: railway run --service api-gateway tsx scripts/upload-avatar-to-railway.ts
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

// Base64-encoded avatar data (lilith-tzel-shani.png)
const avatarBase64 = process.argv[2];
const filename = process.argv[3] || 'lilith-tzel-shani.png';

if (!avatarBase64) {
  console.error('Usage: tsx upload-avatar-to-railway.ts <base64-data> [filename]');
  process.exit(1);
}

async function uploadAvatar() {
  try {
    // Ensure /data/avatars exists
    await mkdir('/data/avatars', { recursive: true });
    console.log('✓ Avatar directory exists');

    // Decode base64 and write file
    const buffer = Buffer.from(avatarBase64, 'base64');
    const filepath = join('/data/avatars', filename);

    await writeFile(filepath, buffer);
    console.log(`✓ Uploaded avatar to ${filepath}`);
    console.log(`  Size: ${buffer.length} bytes`);
    console.log(
      `  Public URL: https://api-gateway-development-83e8.up.railway.app/avatars/${filename}`
    );
  } catch (error) {
    console.error('✗ Failed to upload avatar:', error);
    process.exit(1);
  }
}

uploadAvatar();
