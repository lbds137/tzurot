#!/usr/bin/env node

/**
 * Debug script to list authenticated users
 */

const path = require('path');
const fs = require('fs').promises;

async function listUsers() {
  console.log('👥 Authenticated Users');
  console.log('======================');

  const authFilePath = path.join('./data', 'authentication.json');
  
  try {
    const authData = JSON.parse(await fs.readFile(authFilePath, 'utf8'));
    const userIds = Object.keys(authData);
    
    if (userIds.length === 0) {
      console.log('No authenticated users found');
      return;
    }

    console.log(`Found ${userIds.length} authenticated users:`);
    console.log('');

    userIds.forEach(userId => {
      const userData = authData[userId];
      console.log(`User ID: ${userId}`);
      console.log(`  Token: ${userData.token?.value?.substring(0, 8) + '...' || 'none'}`);
      console.log(`  Expires: ${userData.token?.expiresAt || 'none'}`);
      console.log(`  NSFW Verified: ${userData.nsfwStatus?.verified || false}`);
      console.log(`  Blacklisted: ${userData.blacklisted || false}`);
      console.log(`  Last Auth: ${userData.lastAuthenticatedAt || 'none'}`);
      console.log('');
    });

    console.log('🔍 To test a user: node debug-token-test.js <user_id>');
    console.log('🔧 To invalidate a token: node debug-invalidate-token.js <user_id>');

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No authentication.json file found - no users authenticated yet');
    } else {
      console.error('❌ Failed to read authentication data:', error);
    }
  }
}

listUsers().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});