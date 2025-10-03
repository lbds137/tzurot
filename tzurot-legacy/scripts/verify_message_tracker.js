/**
 * Verification script for MessageTracker functionality
 * 
 * This script directly tests the behavior of the MessageTracker class to 
 * ensure it correctly handles message deduplication.
 * 
 * Run with: node scripts/verify_message_tracker.js
 */

const { messageTracker } = require('../src/messageTracker');
const logger = require('../src/logger');

// Ensure we see all logs
logger.level = 'debug';

// Color codes for output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

/**
 * Run a test function and report results
 * @param {string} name - Test name
 * @param {Function} fn - Test function
 */
function runTest(name, fn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    fn();
    console.log(`${GREEN}✓ PASS${RESET}`);
    return true;
  } catch (error) {
    console.log(`${RED}✗ FAIL${RESET}`);
    console.error(`  ${RED}Error:${RESET} ${error.message}`);
    return false;
  }
}

/**
 * Assert a condition, throw if false
 * @param {boolean} condition 
 * @param {string} message 
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Track test results
let passCount = 0;
let failCount = 0;

// Test basic tracking functionality
passCount += runTest('Basic message tracking', () => {
  const result1 = messageTracker.track('msg-123', 'command');
  const result2 = messageTracker.track('msg-123', 'command');
  
  assert(result1 === true, 'First track should return true');
  assert(result2 === false, 'Second track should return false (duplicate)');
}) ? 1 : 0;

// Test different message types
passCount += runTest('Different message types', () => {
  const result1 = messageTracker.track('msg-456', 'command');
  const result2 = messageTracker.track('msg-456', 'bot-message');
  
  assert(result1 === true, 'First type should return true');
  assert(result2 === true, 'Different type should return true');
}) ? 1 : 0;

// Test operation tracking
passCount += runTest('Operation tracking', () => {
  const result1 = messageTracker.trackOperation('channel-123', 'reply', 'hello');
  const result2 = messageTracker.trackOperation('channel-123', 'reply', 'hello');
  
  assert(result1 === true, 'First operation should return true');
  assert(result2 === false, 'Second operation should return false (duplicate)');
}) ? 1 : 0;

// Test different operation types
passCount += runTest('Different operation types', () => {
  const result1 = messageTracker.trackOperation('channel-456', 'reply', 'hello');
  const result2 = messageTracker.trackOperation('channel-456', 'send', 'hello');
  
  assert(result1 === true, 'First operation type should return true');
  assert(result2 === true, 'Different operation type should return true');
}) ? 1 : 0;

// Test different channels
passCount += runTest('Different channels', () => {
  const result1 = messageTracker.trackOperation('channel-A', 'reply', 'hello');
  const result2 = messageTracker.trackOperation('channel-B', 'reply', 'hello');
  
  assert(result1 === true, 'First channel should return true');
  assert(result2 === true, 'Different channel should return true');
}) ? 1 : 0;

// Test cleanup - this is async but we can verify the Map size
passCount += runTest('Message tracking size', () => {
  const initialSize = messageTracker.size;
  
  // Track 5 new messages
  for (let i = 0; i < 5; i++) {
    messageTracker.track(`unique-msg-${i}`, 'test');
  }
  
  assert(messageTracker.size > initialSize, 'Size should increase after tracking messages');
}) ? 1 : 0;

// Report results
console.log(`\n${YELLOW}Test Results:${RESET}`);
console.log(`${GREEN}${passCount} tests passed${RESET}, ${failCount > 0 ? RED : ''}${failCount} tests failed${RESET}`);

// Provide additional guidance
console.log(`\n${YELLOW}Manual Verification Steps:${RESET}`);
console.log(`1. Start the bot in development mode: ${GREEN}npm run dev${RESET}`);
console.log(`2. Try sending duplicate commands in quick succession`);
console.log(`3. Try replying to the same message multiple times quickly`);
console.log(`4. Check the logs for any unexpected behavior`);

// Exit with appropriate code
process.exit(failCount > 0 ? 1 : 0);