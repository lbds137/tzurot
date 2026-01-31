#!/usr/bin/env node

/**
 * Standalone Personality Data Backup Script
 *
 * This script is completely self-contained with no external dependencies.
 * It backs up complete personality data including memories, knowledge, training,
 * user personalization, and complete chat history from external personality services.
 *
 * Usage:
 * 1. Log into the external service in your browser
 * 2. Open Developer Tools (F12)
 * 3. Go to Application/Storage → Cookies (Chrome/Edge) or Storage → Cookies (Firefox)
 * 4. Find the `appSession` cookie
 * 5. Copy its VALUE (the long string, not the whole cookie)
 * 6. Run: SERVICE_COOKIE="your-cookie-value" SERVICE_WEBSITE="https://service.example.com" PERSONALITY_JARGON_TERM="personalities" node scripts/backup-personalities-data.js personality1 personality2
 *
 * Alternative method (from Network tab):
 * 1. Open Network tab in DevTools
 * 2. Visit any personality page
 * 3. Find request to /api/{jargon_term}/username/ (e.g., /api/personalities/username/)
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
const PERSONALITY_JARGON_TERM = process.env.PERSONALITY_JARGON_TERM;
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
  console.error(
    'SERVICE_COOKIE="abc123..." SERVICE_WEBSITE="https://service.example.com" PERSONALITY_JARGON_TERM="personalities" node backup-personalities-data.js personality1\n'
  );
  process.exit(1);
}

if (!SERVICE_WEBSITE) {
  console.error('\n❌ ERROR: SERVICE_WEBSITE environment variable required\n');
  console.error('This should be the base URL of the service, e.g., https://service.example.com\n');
  process.exit(1);
}

// Profile paths are now constructed dynamically using the jargon term

if (!PERSONALITY_JARGON_TERM) {
  console.error('\n❌ ERROR: PERSONALITY_JARGON_TERM environment variable required\n');
  console.error(
    'This should be the personality service jargon term (e.g., "personalities", "agents", "characters")\n'
  );
  console.error('Example: PERSONALITY_JARGON_TERM="personalities"\n');
  process.exit(1);
}

// Helper to make HTTPS requests
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        Cookie: SERVICE_COOKIE.includes('appSession=')
          ? SERVICE_COOKIE
          : `appSession=${SERVICE_COOKIE}`,
        'User-Agent': 'Mozilla/5.0 (compatible; PersonalityBackup/1.0)',
        Accept: 'application/json',
      },
    };

    https
      .get(url, options, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
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
      })
      .on('error', reject);
  });
}

// Delay helper - simple implementation for standalone script
// eslint-disable-next-line no-restricted-globals, no-restricted-syntax
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

// Save knowledge/story data to a single file
async function saveKnowledgeData(username, knowledge) {
  const personalityDir = path.join(OUTPUT_DIR, username);
  await fs.mkdir(personalityDir, { recursive: true });

  const filePath = path.join(personalityDir, `${username}_knowledge.json`);
  await fs.writeFile(filePath, JSON.stringify(knowledge, null, 2));
  console.log(`  ✓ Saved knowledge/story data for ${username}`);
}

// Save training data to a single file
async function saveTrainingData(username, training) {
  const personalityDir = path.join(OUTPUT_DIR, username);
  await fs.mkdir(personalityDir, { recursive: true });

  const filePath = path.join(personalityDir, `${username}_training.json`);
  await fs.writeFile(filePath, JSON.stringify(training, null, 2));
  console.log(`  ✓ Saved training data for ${username}`);
}

// Save user personalization data to a single file
async function saveUserPersonalizationData(username, userPersonalization) {
  const personalityDir = path.join(OUTPUT_DIR, username);
  await fs.mkdir(personalityDir, { recursive: true });

  const filePath = path.join(personalityDir, `${username}_user_personalization.json`);
  await fs.writeFile(filePath, JSON.stringify(userPersonalization, null, 2));
  console.log(`  ✓ Saved user personalization data for ${username}`);
}

// Save chat history data to a single file
async function saveChatHistoryData(username, personalityId, messages) {
  const personalityDir = path.join(OUTPUT_DIR, username);
  await fs.mkdir(personalityDir, { recursive: true });

  const chatData = {
    shape_id: personalityId,
    shape_name: username,
    message_count: messages.length,
    date_range: {
      earliest: messages.length > 0 ? new Date(messages[0].ts * 1000).toISOString() : null,
      latest: messages.length > 0 ? new Date(messages[messages.length - 1].ts * 1000).toISOString() : null,
    },
    export_date: new Date().toISOString(),
    messages: messages,
  };

  const filePath = path.join(personalityDir, `${username}_chat_history.json`);
  await fs.writeFile(filePath, JSON.stringify(chatData, null, 2));
  console.log(`  ✓ Saved ${messages.length} chat messages for ${username}`);
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
      const timeA =
        typeof a.created_at === 'number'
          ? a.created_at
          : new Date(a.created_at || a.timestamp || 0).getTime() / 1000;
      const timeB =
        typeof b.created_at === 'number'
          ? b.created_at
          : new Date(b.created_at || b.timestamp || 0).getTime() / 1000;
      return timeA - timeB;
    });

    // Save all memories to a single file
    await saveMemoryData(username, allMemories);
  } catch (error) {
    console.error(`  ERROR fetching memories for ${username}: ${error.message}`);
  }
}

// Fetch knowledge/story data for a personality
async function fetchKnowledgeData(personalityId, username) {
  console.log(`\nFetching knowledge/story data for ${username}...`);

  try {
    const url = `${SERVICE_WEBSITE}/api/${PERSONALITY_JARGON_TERM}/${personalityId}/story`;
    console.log(`  Fetching from: ${url}`);
    const response = await httpsGet(url);

    // The knowledge/story endpoint might return different formats
    // Handle both array and object responses
    let knowledge = [];
    if (Array.isArray(response)) {
      knowledge = response;
    } else if (response.items) {
      knowledge = response.items;
    } else if (response.story || response.knowledge) {
      knowledge = response.story || response.knowledge;
    } else if (response && Object.keys(response).length > 0) {
      // If it's a single object, wrap it in an array
      knowledge = [response];
    }

    if (knowledge.length === 0) {
      console.log(`  No knowledge/story data found for ${username}`);
      return;
    }

    // Save knowledge data
    await saveKnowledgeData(username, knowledge);
  } catch (error) {
    console.error(`  ERROR fetching knowledge for ${username}: ${error.message}`);
  }
}

// Fetch training data for a personality
async function fetchTrainingData(personalityId, username) {
  console.log(`\nFetching training data for ${username}...`);

  try {
    const url = `${SERVICE_WEBSITE}/api/${PERSONALITY_JARGON_TERM}/${personalityId}/training`;
    console.log(`  Fetching from: ${url}`);
    const response = await httpsGet(url);

    // The training endpoint should return an array similar to story
    let training = [];
    if (Array.isArray(response)) {
      training = response;
    } else if (response.items) {
      training = response.items;
    } else if (response.training) {
      training = response.training;
    } else if (response && Object.keys(response).length > 0) {
      // If it's a single object, wrap it in an array
      training = [response];
    }

    if (training.length === 0) {
      console.log(`  No training data found for ${username}`);
      return;
    }

    // Save training data
    await saveTrainingData(username, training);
  } catch (error) {
    console.error(`  ERROR fetching training data for ${username}: ${error.message}`);
  }
}

// Fetch user personalization data for a personality
async function fetchUserPersonalizationData(personalityId, username) {
  console.log(`\nFetching user personalization data for ${username}...`);

  try {
    const url = `${SERVICE_WEBSITE}/api/${PERSONALITY_JARGON_TERM}/${personalityId}/user`;
    console.log(`  Fetching from: ${url}`);
    const response = await httpsGet(url);

    // The user personalization endpoint returns a single object
    if (response && Object.keys(response).length > 0) {
      // Save user personalization data
      await saveUserPersonalizationData(username, response);
    } else {
      console.log(`  No user personalization data found for ${username}`);
    }
  } catch (error) {
    console.error(`  ERROR fetching user personalization for ${username}: ${error.message}`);
  }
}

// Fetch complete chat history for a personality
async function fetchChatHistory(personalityId, username) {
  console.log(`\nFetching chat history for ${username}...`);

  try {
    const allMessages = [];
    let beforeTs = null;
    let iteration = 0;
    const CHAT_BATCH_SIZE = 50; // Max messages per request

    while (true) {
      iteration++;
      let url = `${SERVICE_WEBSITE}/api/${PERSONALITY_JARGON_TERM}/${personalityId}/chat/history?limit=${CHAT_BATCH_SIZE}&shape_id=${personalityId}`;
      
      if (beforeTs) {
        url += `&before_ts=${beforeTs}`;
      }

      console.log(`  Fetching batch ${iteration}${beforeTs ? ` (before ${new Date(beforeTs * 1000).toISOString()})` : ''}...`);
      
      const messages = await httpsGet(url);
      
      if (!Array.isArray(messages) || messages.length === 0) {
        console.log(`  No more messages found`);
        break;
      }
      
      allMessages.push(...messages);
      console.log(`  Retrieved ${messages.length} messages (total: ${allMessages.length})`);
      
      // Find earliest timestamp for next batch
      beforeTs = Math.min(...messages.map(m => m.ts));
      
      await delay(DELAY_BETWEEN_REQUESTS);
    }

    // Sort by timestamp (oldest first)
    allMessages.sort((a, b) => a.ts - b.ts);
    
    if (allMessages.length > 0) {
      // Save chat history
      await saveChatHistoryData(username, personalityId, allMessages);
      
      // Calculate statistics
      const totalChars = allMessages.reduce((sum, msg) => {
        return sum + (msg.message?.length || 0) + (msg.reply?.length || 0);
      }, 0);
      console.log(`  Total characters: ${totalChars.toLocaleString()}`);
    } else {
      console.log(`  No chat history found for ${username}`);
    }
  } catch (error) {
    console.error(`  ERROR fetching chat history for ${username}: ${error.message}`);
  }
}

// Fetch complete data for a personality
async function fetchPersonalityData(username) {
  console.log(`\nFetching data for ${username}...`);

  // Get full personality data from authenticated API
  const profileUrl = `${SERVICE_WEBSITE}/api/${PERSONALITY_JARGON_TERM}/username/${username}`;
  const profileData = await httpsGet(profileUrl);

  // Save profile data
  await savePersonalityData(username, profileData);

  // Get personality ID for memory, knowledge, training, and user personalization fetching
  if (profileData.id) {
    await delay(DELAY_BETWEEN_REQUESTS);
    await fetchAllMemories(profileData.id, username);

    await delay(DELAY_BETWEEN_REQUESTS);
    await fetchKnowledgeData(profileData.id, username);

    await delay(DELAY_BETWEEN_REQUESTS);
    await fetchTrainingData(profileData.id, username);

    await delay(DELAY_BETWEEN_REQUESTS);
    await fetchUserPersonalizationData(profileData.id, username);

    await delay(DELAY_BETWEEN_REQUESTS);
    await fetchChatHistory(profileData.id, username);
  } else {
    console.log(
      `  WARNING: No ID found for ${username}, skipping memories, knowledge, training, user personalization, and chat history`
    );
  }
}

// Main function
async function main() {
  console.log('External Service Data Backup Script');
  console.log('===================================\n');

  // Show configuration
  console.log('Configuration:');
  console.log(`  Service URL: ${SERVICE_WEBSITE}`);
  console.log(`  Jargon Term: ${PERSONALITY_JARGON_TERM}`);
  console.log(`  Profile Path: ${PERSONALITY_JARGON_TERM}/username`);
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
    console.log(
      'SERVICE_COOKIE="your-cookie" SERVICE_WEBSITE="https://service.example.com" PERSONALITY_JARGON_TERM="personalities" node backup-personalities-data.js personality1 personality2 ...'
    );
    process.exit(1);
  }

  console.log(`Backing up ${personalities.length} personalities...`);

  let successCount = 0;
  let shouldContinue = true;

  // Process each personality
  for (let i = 0; i < personalities.length; i++) {
    if (!shouldContinue) break;
    
    const username = personalities[i];
    try {
      await fetchPersonalityData(username);
      successCount++;
      
      if (i < personalities.length - 1) {
        await delay(DELAY_BETWEEN_REQUESTS * 2); // Extra delay between personalities
      }
    } catch (error) {
      // Check if it's a 401 Unauthorized error
      if (error.message.includes('401')) {
        console.error(`\n❌ Authentication failed! Your session cookie may have expired.`);
        console.error(`Successfully backed up ${successCount} of ${personalities.length} personalities before failure.\n`);
        console.error(`Please get a fresh session cookie from your browser and try again.`);
        shouldContinue = false;
      } else {
        console.error(`ERROR: Failed to fetch ${username}: ${error.message}`);
        // Continue with next personality for non-auth errors
      }
    }
  }

  if (shouldContinue) {
    console.log('\n✅ Backup complete!');
    console.log(`Data saved to: ${OUTPUT_DIR}`);
  } else {
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error('FATAL ERROR:', error);
  process.exit(1);
});
