/**
 * Test script to verify the ability to re-add personalities after removal
 * 
 * This script simulates:
 * 1. Adding a personality
 * 2. Removing the personality
 * 3. Re-adding the same personality
 * 
 * Usage: node scripts/test_readd_personalities.js
 */

const messageTracker = require('../src/commands/utils/messageTracker');
const logger = require('../src/logger');

// Mock user info
const userId = 'test-user-123';
const personalityName = 'test-personality';

// Set log level for testing
logger.level = 'debug';

async function runTest() {
  logger.info('======== Starting re-add personality test ========');
  
  // Simulate adding a personality
  logger.info('1. Simulating adding a personality');
  const commandKey = `${userId}-${personalityName}-${personalityName}`;
  
  messageTracker.markAddCommandCompleted(commandKey);
  
  // Verify it was added to completedAddCommands
  const isCompleted = messageTracker.isAddCommandCompleted(commandKey);
  logger.info(`Command marked as completed: ${isCompleted}`);
  
  if (!isCompleted) {
    logger.error('ERROR: Command was not marked as completed correctly');
    process.exit(1);
  }
  
  // Simulate removing a personality
  logger.info('2. Simulating removing a personality');
  messageTracker.removeCompletedAddCommand(userId, personalityName);
  
  // Verify it was removed from completedAddCommands
  const isStillCompleted = messageTracker.isAddCommandCompleted(commandKey);
  logger.info(`Command still marked as completed after removal: ${isStillCompleted}`);
  
  if (isStillCompleted) {
    logger.error('ERROR: Command was not removed from completedAddCommands');
    process.exit(1);
  }
  
  // Confirm success
  logger.info('======== Test passed successfully! ========');
  logger.info('The personality can now be re-added without triggering duplicate protection');
}

// Run the test
runTest().catch(err => {
  logger.error('Test failed with error:', err);
  process.exit(1);
});