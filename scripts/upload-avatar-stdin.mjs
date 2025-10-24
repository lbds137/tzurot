#!/usr/bin/env node
/**
 * Upload avatar from stdin
 * Usage: cat avatar.png | railway run --service api-gateway node scripts/upload-avatar-stdin.mjs lilith-tzel-shani.png
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const filename = process.argv[2];
if (!filename) {
  console.error('Usage: cat file.png | node upload-avatar-stdin.mjs <filename>');
  process.exit(1);
}

const chunks = [];
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', async () => {
  try {
    const buffer = Buffer.concat(chunks);

    await mkdir('/data/avatars', { recursive: true });
    await writeFile(join('/data/avatars', filename), buffer);

    console.log(`✓ Uploaded ${filename} (${buffer.length} bytes)`);
    console.log(`  URL: https://api-gateway-development-83e8.up.railway.app/avatars/${filename}`);
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
});
