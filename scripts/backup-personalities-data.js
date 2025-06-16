#!/usr/bin/env node

/**
 * External Service Data Backup Script
 * 
 * Pulls complete personality data including memories from the external service
 * 
 * Usage:
 * 1. Log into the external service in your browser
 * 2. Open Developer Tools (F12)
 * 3. Go to Application/Storage → Cookies (Chrome/Edge) or Storage → Cookies (Firefox)
 * 4. Find the `appSession` cookie
 * 5. Copy its VALUE (the long string, not the whole cookie)
 * 6. Run: SERVICE_COOKIE="your-cookie-value" SERVICE_WEBSITE="https://service.example.com" PROFILE_INFO_PRIVATE_PATH="personalities/username" node scripts/backup-personalities-data.js personality1 personality2
 * 
 * Alternative method (from Network tab):
 * 1. Open Network tab in DevTools
 * 2. Visit any personality page  
 * 3. Find request to /api/personalities/username/ (or your configured PROFILE_INFO_PRIVATE_PATH)
 * 4. Look at Request Headers → Cookie header
 * 5. Copy only the appSession=xxx part
 */

const fs = require('fs').promises;
const path = require('path');
const https = require('https');

// Configuration
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'service-backup');
const SERVICE_COOKIE = process.env.SERVICE_COOKIE;
const SERVICE_WEBSITE = process.env.SERVICE_WEBSITE;
const PROFILE_INFO_PRIVATE_PATH = process.env.PROFILE_INFO_PRIVATE_PATH;
const DELAY_BETWEEN_REQUESTS = 1000; // Be respectful, 1 second between requests

if (!SERVICE_COOKIE) {
  console.error('\n❌ ERROR: SERVICE_COOKIE environment variable required\n');
  console.error('How to get your session cookie:');
  console.error('1. Open the service website in your browser and log in');
  console.error('2. Open Developer Tools (F12)');
  console.error('3. Go to Application/Storage → Cookies');
  console.error('4. Find the `appSession` cookie');
  console.error('5. Copy its VALUE (the long string)\n');
  console.error('Example:');
  console.error('SERVICE_COOKIE="abc123..." SERVICE_WEBSITE="https://service.com" node scripts/backup-personalities-data.js personality1\n');
  process.exit(1);
}

if (!SERVICE_WEBSITE) {
  console.error('\n❌ ERROR: SERVICE_WEBSITE environment variable required\n');
  console.error('This should be the base URL of the service, e.g., https://service.example.com\n');
  process.exit(1);
}

if (!PROFILE_INFO_PRIVATE_PATH) {
  console.error('\n❌ ERROR: PROFILE_INFO_PRIVATE_PATH environment variable required\n');
  console.error('This is usually "personalities/username" or similar\n');
  process.exit(1);
}

// Helper to make HTTPS requests
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'Cookie': SERVICE_COOKIE.includes('appSession=') ? SERVICE_COOKIE : `appSession=${SERVICE_COOKIE}`,
        'User-Agent': 'Mozilla/5.0 (compatible; PersonalityBackup/1.0)',
        'Accept': 'application/json'
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

// Save all memories to a single file
async function saveMemoryData(username, memories) {
  const personalityDir = path.join(OUTPUT_DIR, username);
  await fs.mkdir(personalityDir, { recursive: true });
  
  const filePath = path.join(personalityDir, `${username}_memories.json`);
  await fs.writeFile(filePath, JSON.stringify(memories, null, 2));
  console.log(`  ✓ Saved ${memories.length} memories for ${username}`);
}

// Fetch all memories for a personality
async function fetchAllMemories(personalityId, username) {
  console.log(`\nFetching memories for ${username}...`);
  
  try {
    const allMemories = [];
    let page = 1;
    let totalPages = 1;
    
    // Fetch all pages
    while (page <= totalPages) {
      const url = `${SERVICE_WEBSITE}/api/memory/${personalityId}?page=${page}`;
      console.log(`  Fetching page ${page}...`);
      const response = await httpsGet(url);
      
      // Handle different response formats
      const memories = response.items || response.memories || [];
      if (memories.length === 0 && page === 1) {
        console.log(`  No memories found for ${username}`);
        return;
      }
      
      // Add memories to our collection
      allMemories.push(...memories);
      
      // Update total pages from pagination
      const pagination = response.pagination || response.meta?.pagination;
      if (pagination) {
        totalPages = pagination.total_pages || pagination.totalPages || 1;
      }
      
      if (page === 1) {
        console.log(`  Total memory pages: ${totalPages}`);
      }
      
      page++;
      if (page <= totalPages) {
        await delay(DELAY_BETWEEN_REQUESTS);
      }
    }
    
    // Sort memories by created_at timestamp (oldest first)
    allMemories.sort((a, b) => {
      // Handle both timestamp formats: Unix timestamp (number) and ISO string
      const timeA = typeof a.created_at === 'number' ? a.created_at : new Date(a.created_at || a.timestamp || 0).getTime() / 1000;
      const timeB = typeof b.created_at === 'number' ? b.created_at : new Date(b.created_at || b.timestamp || 0).getTime() / 1000;
      return timeA - timeB;
    });
    
    // Save all memories to a single file
    await saveMemoryData(username, allMemories);
    
  } catch (error) {
    console.error(`  ERROR fetching memories for ${username}: ${error.message}`);
  }
}

// Fetch complete data for a personality
async function fetchPersonalityData(username) {
  try {
    console.log(`\nFetching data for ${username}...`);
    
    // Get full personality data from authenticated API
    const profileUrl = `${SERVICE_WEBSITE}/api/${PROFILE_INFO_PRIVATE_PATH}/${username}`;
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
  console.log('External Service Data Backup Script');
  console.log('===================================\n');
  
  // Show configuration
  console.log('Configuration:');
  console.log(`  Service URL: ${SERVICE_WEBSITE}`);
  console.log(`  Profile Path: ${PROFILE_INFO_PRIVATE_PATH}`);
  console.log(`  Cookie: ${SERVICE_COOKIE ? SERVICE_COOKIE.substring(0, 20) + '...' : 'NOT SET'}`);
  console.log(`  Output Directory: ${OUTPUT_DIR}\n`);
  
  await ensureOutputDir();
  
  // Get list of personalities to backup
  // You'll need to provide this list - either from your existing data
  // or by manually listing them
  const personalities = process.argv.slice(2);
  
  if (personalities.length === 0) {
    console.log('\n❌ ERROR: No personalities specified\n');
    console.log('Usage:');
    console.log('SERVICE_COOKIE="your-cookie" SERVICE_WEBSITE="https://service.com" PROFILE_INFO_PRIVATE_PATH="personalities/username" node scripts/backup-personalities-data.js personality1 personality2 ...');
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