#!/usr/bin/env node

/**
 * Debug script to test token validation with the AI service
 * 
 * Usage:
 * node debug-token-test.js [discord_user_id]
 * 
 * This will:
 * 1. Load the user's token from the authentication repository
 * 2. Test validation with the AI service
 * 3. Show detailed logging of the validation process
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs').promises;
const { ApplicationBootstrap } = require('./src/application/bootstrap/ApplicationBootstrap');

async function debugTokenValidation(discordUserId) {
  console.log('🔍 Debug Token Validation Test');
  console.log('=====================================');
  console.log(`Target user: ${discordUserId}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`API Base URL: ${process.env.SERVICE_API_BASE_URL}`);
  console.log('');

  try {
    // Initialize the application bootstrap
    const bootstrap = new ApplicationBootstrap();
    await bootstrap.initialize();
    
    const authService = bootstrap.getApplicationServices().authenticationService;
    
    console.log('📋 Step 1: Getting user authentication status (client-side only)');
    
    // First check if repository can find the user directly
    const authRepo = bootstrap.getApplicationServices().authenticationRepository;
    console.log('Checking repository directly...');
    
    // Check the raw cache data
    console.log('Raw repository cache for user:', authRepo._cache?.userAuth?.[discordUserId] || 'not found');
    
    const directLookup = await authRepo.findByUserId(discordUserId);
    console.log('Direct repository lookup result:', {
      found: !!directLookup,
      userId: directLookup?.userId?.toString() || 'none',
      hasToken: !!directLookup?.token,
      tokenPrefix: directLookup?.token?.value?.substring(0, 8) + '...' || 'none',
      isAuthenticated: directLookup?.isAuthenticated() || false
    });
    console.log('');
    
    const clientStatus = await authService.getAuthenticationStatus(discordUserId, false);
    console.log('Client-side status:', {
      isAuthenticated: clientStatus.isAuthenticated,
      hasUser: !!clientStatus.user,
      hasToken: !!clientStatus.user?.token,
      tokenPrefix: clientStatus.user?.token?.value?.substring(0, 8) + '...' || 'none'
    });
    console.log('');

    if (!clientStatus.isAuthenticated || !clientStatus.user?.token) {
      console.log('❌ User has no token, cannot test AI service validation');
      return;
    }

    console.log('📋 Step 2: Testing AI service validation');
    const aiStatus = await authService.getAuthenticationStatus(discordUserId, true);
    console.log('AI service validation status:', {
      isAuthenticated: aiStatus.isAuthenticated,
      hasUser: !!aiStatus.user,
      hasToken: !!aiStatus.user?.token
    });
    console.log('');

    // Also check the raw authentication data file
    console.log('📋 Step 3: Raw authentication data');
    const authFilePath = path.join('./data', 'authentication.json');
    try {
      const authData = JSON.parse(await fs.readFile(authFilePath, 'utf8'));
      const userData = authData[discordUserId];
      if (userData) {
        console.log('Raw auth data:', {
          userId: userData.userId,
          hasToken: !!userData.token,
          tokenPrefix: userData.token?.value?.substring(0, 8) + '...' || 'none',
          tokenExpiresAt: userData.token?.expiresAt || 'none',
          nsfwVerified: userData.nsfwStatus?.verified || false,
          blacklisted: userData.blacklisted || false,
          lastAuthenticatedAt: userData.lastAuthenticatedAt
        });
      } else {
        console.log('No raw auth data found for user');
      }
    } catch (error) {
      console.log('Could not read raw auth data:', error.message);
    }
    console.log('');

    console.log('✅ Debug test completed');

  } catch (error) {
    console.error('❌ Debug test failed:', error);
  }
}

// Get Discord user ID from command line args
const discordUserId = process.argv[2];
if (!discordUserId) {
  console.log('Usage: node debug-token-test.js <discord_user_id>');
  console.log('Example: node debug-token-test.js 278863839632818186');
  process.exit(1);
}

debugTokenValidation(discordUserId).then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});