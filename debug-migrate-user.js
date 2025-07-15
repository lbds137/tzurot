#!/usr/bin/env node

/**
 * Debug script to migrate a legacy user to DDD system for testing
 * 
 * Usage:
 * node debug-migrate-user.js [discord_user_id]
 * 
 * This will:
 * 1. Read user from legacy auth_tokens.json
 * 2. Create a UserAuth in the DDD system
 * 3. Save to authentication.json
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs').promises;
const { ApplicationBootstrap } = require('./src/application/bootstrap/ApplicationBootstrap');

async function migrateUser(discordUserId) {
  console.log('🔄 Debug User Migration');
  console.log('=======================');
  console.log(`Target user: ${discordUserId}`);
  console.log('');

  try {
    // Read legacy auth data
    console.log('📋 Step 1: Reading legacy authentication data');
    const legacyAuthPath = path.join('./data', 'auth_tokens.json');
    const legacyData = JSON.parse(await fs.readFile(legacyAuthPath, 'utf8'));
    
    const legacyUser = legacyData[discordUserId];
    if (!legacyUser) {
      console.log('❌ User not found in legacy auth data');
      return;
    }
    
    console.log('Legacy user data:', {
      userId: discordUserId,
      tokenPrefix: legacyUser.token?.substring(0, 8) + '...' || 'none',
      createdAt: new Date(legacyUser.createdAt).toISOString(),
      expiresAt: new Date(legacyUser.expiresAt).toISOString()
    });
    console.log('');

    // Initialize DDD system
    console.log('📋 Step 2: Initializing DDD system');
    const bootstrap = new ApplicationBootstrap();
    await bootstrap.initialize();
    
    const authService = bootstrap.getApplicationServices().authenticationService;
    console.log('');

    // Check if user already exists
    console.log('📋 Step 3: Checking if user already exists in DDD system');
    const existingStatus = await authService.getAuthenticationStatus(discordUserId);
    if (existingStatus.isAuthenticated) {
      console.log('✅ User already exists in DDD system');
      console.log('Current status:', {
        isAuthenticated: existingStatus.isAuthenticated,
        hasToken: !!existingStatus.user?.token,
        tokenPrefix: existingStatus.user?.token?.value?.substring(0, 8) + '...' || 'none'
      });
      return;
    }
    console.log('User does not exist in DDD system, proceeding with migration');
    console.log('');

    // Create UserAuth directly using legacy token
    console.log('📋 Step 4: Creating UserAuth in DDD system');
    
    // Create authenticated user with legacy token
    const expiresAt = new Date(legacyUser.expiresAt);
    
    // Use the legacy exchangeToken method to simulate getting a token
    console.log('Simulating token exchange using legacy token data...');
    
    // We'll create the UserAuth directly since we have the token
    const { UserAuth, Token } = require('./src/domain/authentication');
    const { UserId } = require('./src/domain/personality');
    
    const userId = new UserId(discordUserId);
    const token = new Token(legacyUser.token, expiresAt);
    
    const userAuth = UserAuth.createAuthenticated(userId, token);
    
    // Verify NSFW status (assume legacy users were verified)
    userAuth.verifyNsfw();
    
    // Save to repository
    const authRepo = bootstrap.getApplicationServices().authenticationRepository;
    await authRepo.save(userAuth);
    
    console.log('✅ User migrated successfully');
    console.log('');

    // Verify migration
    console.log('📋 Step 5: Verifying migration');
    const newStatus = await authService.getAuthenticationStatus(discordUserId);
    console.log('Migration verification:', {
      isAuthenticated: newStatus.isAuthenticated,
      hasUser: !!newStatus.user,
      hasToken: !!newStatus.user?.token,
      tokenPrefix: newStatus.user?.token?.value?.substring(0, 8) + '...' || 'none'
    });
    console.log('');

    console.log('🔍 Now you can test with: node debug-token-test.js ' + discordUserId);

  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

// Get Discord user ID from command line args
const discordUserId = process.argv[2];
if (!discordUserId) {
  console.log('Usage: node debug-migrate-user.js <discord_user_id>');
  console.log('Example: node debug-migrate-user.js 278863839632818186');
  process.exit(1);
}

migrateUser(discordUserId).then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});