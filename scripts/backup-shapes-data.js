#!/usr/bin/env node

/**
 * Shapes.inc Data Backup Script
 * 
 * Pulls complete personality data including memories before the $100/month paywall
 * 
 * Usage:
 * 1. Log into shapes.inc in your browser
 * 2. Open DevTools > Network tab
 * 3. Visit any personality page
 * 4. Find request to /api/shapes/username/
 * 5. Copy the Cookie header value
 * 6. Run: SHAPES_COOKIE="your-cookie-here" node scripts/backup-shapes-data.js
 */

const fs = require('fs').promises;
const path = require('path');
const https = require('https');

// Configuration
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'shapes-backup');
const SHAPES_COOKIE = process.env.SHAPES_COOKIE;
const DELAY_BETWEEN_REQUESTS = 1000; // Be respectful, 1 second between requests

if (!SHAPES_COOKIE) {
  console.error('ERROR: SHAPES_COOKIE environment variable required');
  console.error('Get this from browser DevTools after logging into shapes.inc');
  process.exit(1);
}

// Helper to make HTTPS requests
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'Cookie': SHAPES_COOKIE,
        'User-Agent': 'Mozilla/5.0 (compatible; PersonalityBackup/1.0)'
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode} from ${url}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

// Delay helper
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Ensure output directory exists
async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

// Save personality data
async function savePersonalityData(username, data) {
  const personalityDir = path.join(OUTPUT_DIR, username);
  await fs.mkdir(personalityDir, { recursive: true });
  
  const filePath = path.join(personalityDir, `${username}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  console.log(`✓ Saved profile: ${username}`);
}

// Save memory data
async function saveMemoryData(username, memories, pageNum) {
  const memoryDir = path.join(OUTPUT_DIR, username, 'memory');
  await fs.mkdir(memoryDir, { recursive: true });
  
  const filePath = path.join(memoryDir, `${username}_memory_${pageNum}.json`);
  await fs.writeFile(filePath, JSON.stringify(memories, null, 2));
  console.log(`  ✓ Saved memory page ${pageNum} for ${username}`);
}

// Fetch all memories for a personality
async function fetchAllMemories(personalityId, username) {
  console.log(`\nFetching memories for ${username}...`);
  
  try {
    // First request to get pagination info
    let page = 1;
    const firstUrl = `https://shapes.inc/api/memory/${personalityId}?page=${page}`;
    const firstResponse = await httpsGet(firstUrl);
    
    if (!firstResponse.memories || !firstResponse.pagination) {
      console.log(`  No memories found for ${username}`);
      return;
    }
    
    // Save first page
    await saveMemoryData(username, firstResponse, page);
    await delay(DELAY_BETWEEN_REQUESTS);
    
    // Get total pages from pagination
    const totalPages = firstResponse.pagination.total_pages;
    console.log(`  Total memory pages: ${totalPages}`);
    
    // Fetch remaining pages
    for (page = 2; page <= totalPages; page++) {
      const url = `https://shapes.inc/api/memory/${personalityId}?page=${page}`;
      const response = await httpsGet(url);
      await saveMemoryData(username, response, page);
      await delay(DELAY_BETWEEN_REQUESTS);
    }
    
  } catch (error) {
    console.error(`  ERROR fetching memories for ${username}: ${error.message}`);
  }
}

// Fetch complete data for a personality
async function fetchPersonalityData(username) {
  try {
    console.log(`\nFetching data for ${username}...`);
    
    // Get full personality data from authenticated API
    const profileUrl = `https://shapes.inc/api/shapes/username/${username}`;
    const profileData = await httpsGet(profileUrl);
    
    // Save profile data
    await savePersonalityData(username, profileData);
    
    // Get personality ID for memory fetching
    if (profileData.id) {
      await delay(DELAY_BETWEEN_REQUESTS);
      await fetchAllMemories(profileData.id, username);
    } else {
      console.log(`  WARNING: No ID found for ${username}, skipping memories`);
    }
    
  } catch (error) {
    console.error(`ERROR: Failed to fetch ${username}: ${error.message}`);
  }
}

// Main function
async function main() {
  console.log('Shapes.inc Data Backup Script');
  console.log('=============================\n');
  
  await ensureOutputDir();
  
  // Get list of personalities to backup
  // You'll need to provide this list - either from your existing data
  // or by manually listing them
  const personalities = process.argv.slice(2);
  
  if (personalities.length === 0) {
    console.log('Usage: SHAPES_COOKIE="..." node backup-shapes-data.js personality1 personality2 ...');
    console.log('\nExample:');
    console.log('SHAPES_COOKIE="..." node backup-shapes-data.js lilith-tzel-shani ha-shem-keev-ima lila-ani-tzuratech');
    process.exit(1);
  }
  
  console.log(`Backing up ${personalities.length} personalities...`);
  
  // Process each personality
  for (const username of personalities) {
    await fetchPersonalityData(username);
    await delay(DELAY_BETWEEN_REQUESTS * 2); // Extra delay between personalities
  }
  
  console.log('\n✅ Backup complete!');
  console.log(`Data saved to: ${OUTPUT_DIR}`);
}

// Run the script
main().catch(error => {
  console.error('FATAL ERROR:', error);
  process.exit(1);
});