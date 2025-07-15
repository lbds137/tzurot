#!/usr/bin/env node

/**
 * Debug script to manually invalidate a token for testing
 * 
 * Usage:
 * node debug-invalidate-token.js [discord_user_id]
 * 
 * This will modify the user's token to be invalid by:
 * 1. Adding "INVALID_" prefix to make it invalid
 * 2. Setting expiry to past date (though this won't matter with our changes)
 */

const path = require('path');
const fs = require('fs').promises;

async function invalidateToken(discordUserId) {
  console.log('🔧 Debug Token Invalidation');
  console.log('===============================');
  console.log(`Target user: ${discordUserId}`);
  console.log('');

  const authFilePath = path.join('./data', 'auth.json');
  
  try {
    // Read current auth data
    console.log('📋 Step 1: Reading current authentication data');
    const authData = JSON.parse(await fs.readFile(authFilePath, 'utf8'));
    
    if (!authData.userAuth || !authData.userAuth[discordUserId]) {
      console.log('❌ User not found in authentication data');
      return;
    }

    const userData = authData.userAuth[discordUserId];
    console.log('Current user data:', {
      userId: userData.userId,
      hasToken: !!userData.token,
      tokenPrefix: userData.token?.value?.substring(0, 8) + '...' || 'none',
      tokenExpiresAt: userData.token?.expiresAt || 'none'
    });
    console.log('');

    if (!userData.token) {
      console.log('❌ User has no token to invalidate');
      return;
    }

    // Invalidate the token
    console.log('📋 Step 2: Invalidating token');
    const originalToken = userData.token.value;
    const invalidToken = 'INVALID_' + originalToken;
    
    userData.token.value = invalidToken;
    userData.token.expiresAt = '2020-01-01T00:00:00.000Z'; // Past date
    
    console.log('Token invalidated:', {
      originalPrefix: originalToken.substring(0, 8) + '...',
      invalidPrefix: invalidToken.substring(0, 16) + '...',
      newExpiresAt: userData.token.expiresAt
    });
    console.log('');

    // Write back to file
    console.log('📋 Step 3: Saving modified authentication data');
    await fs.writeFile(authFilePath, JSON.stringify(authData, null, 2), 'utf8');
    console.log('✅ Authentication data saved');
    console.log('');

    console.log('🔍 Now you can test with: node debug-token-test.js ' + discordUserId);

  } catch (error) {
    console.error('❌ Failed to invalidate token:', error);
  }
}

// Get Discord user ID from command line args
const discordUserId = process.argv[2];
if (!discordUserId) {
  console.log('Usage: node debug-invalidate-token.js <discord_user_id>');
  console.log('Example: node debug-invalidate-token.js 278863839632818186');
  process.exit(1);
}

invalidateToken(discordUserId).then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});