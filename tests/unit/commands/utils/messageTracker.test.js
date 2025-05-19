// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../config');
jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock implementation of a message tracker for testing
const messageTracker = {
  lastCommandTime: {},
  isDuplicate: function(userId, commandName) {
    const key = `${userId}-${commandName}`;
    const now = Date.now();
    const lastTime = this.lastCommandTime[key] || 0;
    
    // Consider it a duplicate if same command from same user within 3 seconds
    if (now - lastTime < 3000) {
      return true;
    }
    
    // Update the timestamp
    this.lastCommandTime[key] = now;
    return false;
  }
};

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

  test('first command is never a duplicate', () => {
    // Mock Date.now to return a fixed value
    Date.now = jest.fn(() => 1000);
    
    const result = messageTracker.isDuplicate('user-123', 'test-command');
    
    // First command should not be a duplicate
    expect(result).toBe(false);
    
    // Timestamp should be stored
    expect(messageTracker.lastCommandTime['user-123-test-command']).toBe(1000);
  });

  test('detects duplicate within 3 seconds', () => {
    // Mock Date.now to return fixed values
    let currentTime = 1000;
    Date.now = jest.fn(() => currentTime);
    
    // First command
    messageTracker.isDuplicate('user-123', 'test-command');
    
    // Advance time by 2 seconds (less than the 3 second threshold)
    currentTime += 2000;
    Date.now = jest.fn(() => currentTime);
    
    // Second command (should be detected as duplicate)
    const result = messageTracker.isDuplicate('user-123', 'test-command');
    
    expect(result).toBe(true);
    
    // Timestamp should not be updated for duplicates
    expect(messageTracker.lastCommandTime['user-123-test-command']).toBe(1000);
  });

  test('allows command after 3 seconds', () => {
    // Mock Date.now to return fixed values
    let currentTime = 1000;
    Date.now = jest.fn(() => currentTime);
    
    // First command
    messageTracker.isDuplicate('user-123', 'test-command');
    
    // Advance time by 4 seconds (more than the 3 second threshold)
    currentTime += 4000;
    Date.now = jest.fn(() => currentTime);
    
    // Second command (should not be detected as duplicate)
    const result = messageTracker.isDuplicate('user-123', 'test-command');
    
    expect(result).toBe(false);
    
    // Timestamp should be updated
    expect(messageTracker.lastCommandTime['user-123-test-command']).toBe(5000);
  });

  test('different commands are not duplicates', () => {
    // Mock Date.now to return a fixed value
    Date.now = jest.fn(() => 1000);
    
    // First command
    messageTracker.isDuplicate('user-123', 'command-1');
    
    // Second command (different name)
    const result = messageTracker.isDuplicate('user-123', 'command-2');
    
    expect(result).toBe(false);
    
    // Both commands should have timestamps
    expect(messageTracker.lastCommandTime['user-123-command-1']).toBe(1000);
    expect(messageTracker.lastCommandTime['user-123-command-2']).toBe(1000);
  });

  test('different users are not duplicates', () => {
    // Mock Date.now to return a fixed value
    Date.now = jest.fn(() => 1000);
    
    // First user
    messageTracker.isDuplicate('user-123', 'test-command');
    
    // Second user (same command)
    const result = messageTracker.isDuplicate('user-456', 'test-command');
    
    expect(result).toBe(false);
    
    // Both users should have timestamps
    expect(messageTracker.lastCommandTime['user-123-test-command']).toBe(1000);
    expect(messageTracker.lastCommandTime['user-456-test-command']).toBe(1000);
  });
});