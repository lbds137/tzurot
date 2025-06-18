#!/usr/bin/env node

/**
 * Test script to verify alias command integration with PersonalityRouter
 */

const { getPersonalityRouter } = require('../src/application/routers/PersonalityRouter');
const logger = require('../src/logger');

async function testAliasIntegration() {
  logger.info('Testing alias command integration with PersonalityRouter...');
  
  try {
    // Get the router instance
    const router = getPersonalityRouter();
    
    // Test data
    const personalityName = 'testbot';
    const newAlias = 'testalias';
    const userId = '123456789';
    
    logger.info(`Testing addAlias with:
    - Personality: ${personalityName}
    - Alias: ${newAlias}
    - User ID: ${userId}`);
    
    // Call addAlias through the router
    const result = await router.addAlias(personalityName, newAlias, userId);
    
    if (result.success) {
      logger.info('✅ Success! Alias added successfully.');
      logger.info(`Result: ${JSON.stringify(result, null, 2)}`);
    } else {
      logger.error('❌ Failed to add alias:');
      logger.error(`Error: ${result.message || 'Unknown error'}`);
    }
    
  } catch (error) {
    logger.error('❌ Test failed with error:', error);
  }
}

// Run the test
testAliasIntegration().catch(console.error);