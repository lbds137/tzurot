// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../config');
jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Import the actual message tracker
const messageTracker = require('../../../../src/commands/utils/messageTracker');

describe('Message Tracker Duplicate Detection', () => {
  let originalDateNow;
  
  beforeEach(() => {
    // Save the original Date.now function
    originalDateNow = Date.now;
    // Reset the lastCommandTime object before each test
    messageTracker.lastCommandTime = {};
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    // Restore the original Date.now function
    Date.now = originalDateNow;
  });

  test('first command is never a recent duplicate', () => {
    // Mock Date.now to return a fixed value
    Date.now = jest.fn(() => 1000);
    
    const result = messageTracker.isRecentCommand('user-123', 'test-command', []);
    
    // First command should not be a duplicate
    expect(result).toBe(false);
    
    // Second immediate execution should be detected as duplicate
    const secondResult = messageTracker.isRecentCommand('user-123', 'test-command', []);
    expect(secondResult).toBe(true);
  });

  test('detects duplicate command within 3 seconds', () => {
    // Mock Date.now to return fixed values
    let currentTime = 1000;
    Date.now = jest.fn(() => currentTime);
    
    // First command
    messageTracker.isRecentCommand('user-123', 'test-command', []);
    
    // Advance time by 2 seconds (less than the 3 second threshold)
    currentTime += 2000;
    Date.now = jest.fn(() => currentTime);
    
    // Second command (should be detected as duplicate)
    const result = messageTracker.isRecentCommand('user-123', 'test-command', []);
    
    expect(result).toBe(true);
  });

  test('allows command after 3 seconds', () => {
    // Mock Date.now to return fixed values
    let currentTime = 1000;
    Date.now = jest.fn(() => currentTime);
    
    // First command
    messageTracker.isRecentCommand('user-123', 'test-command', []);
    
    // Advance time by 4 seconds (more than the 3 second threshold)
    currentTime += 4000;
    Date.now = jest.fn(() => currentTime);
    
    // Second command (should not be detected as duplicate)
    const result = messageTracker.isRecentCommand('user-123', 'test-command', []);
    
    expect(result).toBe(false);
  });

  test('different commands are not duplicates', () => {
    // Mock Date.now to return a fixed value
    Date.now = jest.fn(() => 1000);
    
    // First command
    messageTracker.isRecentCommand('user-123', 'command-1', []);
    
    // Second command (different name)
    const result = messageTracker.isRecentCommand('user-123', 'command-2', []);
    
    expect(result).toBe(false);
  });

  test('different users are not duplicates', () => {
    // Mock Date.now to return a fixed value
    Date.now = jest.fn(() => 1000);
    
    // First user
    messageTracker.isRecentCommand('user-123', 'test-command', []);
    
    // Second user (same command)
    const result = messageTracker.isRecentCommand('user-456', 'test-command', []);
    
    expect(result).toBe(false);
  });
  
  test('arguments affect duplicate detection', () => {
    // Mock Date.now to return a fixed value
    Date.now = jest.fn(() => 1000);
    
    // First command with specific args
    messageTracker.isRecentCommand('user-123', 'test-command', ['arg1']);
    
    // Same command with different args should not be a duplicate
    const result = messageTracker.isRecentCommand('user-123', 'test-command', ['arg2']);
    
    expect(result).toBe(false);
  });
});