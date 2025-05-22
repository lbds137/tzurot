/**
 * Jest setup file to handle global test environment configuration
 * This file runs before each test file to set up proper mocking and cleanup
 */

// Store original timers for cleanup
const originalSetInterval = global.setInterval;
const originalSetTimeout = global.setTimeout;
const originalClearInterval = global.clearInterval;
const originalClearTimeout = global.clearTimeout;

// Track active timers for cleanup
const activeIntervals = new Set();
const activeTimeouts = new Set();

// Override setInterval to track intervals
global.setInterval = function(callback, delay, ...args) {
  const intervalId = originalSetInterval(callback, delay, ...args);
  activeIntervals.add(intervalId);
  return intervalId;
};

// Override setTimeout to track timeouts
global.setTimeout = function(callback, delay, ...args) {
  const timeoutId = originalSetTimeout(callback, delay, ...args);
  activeTimeouts.add(timeoutId);
  return timeoutId;
};

// Override clearInterval to untrack intervals
global.clearInterval = function(intervalId) {
  activeIntervals.delete(intervalId);
  return originalClearInterval(intervalId);
};

// Override clearTimeout to untrack timeouts
global.clearTimeout = function(timeoutId) {
  activeTimeouts.delete(timeoutId);
  return originalClearTimeout(timeoutId);
};

// Cleanup function to clear all active timers
function cleanup() {
  // Clear all active intervals
  for (const intervalId of activeIntervals) {
    originalClearInterval(intervalId);
  }
  activeIntervals.clear();
  
  // Clear all active timeouts
  for (const timeoutId of activeTimeouts) {
    originalClearTimeout(timeoutId);
  }
  activeTimeouts.clear();
}

// Set up test environment
beforeEach(() => {
  // Set NODE_ENV to test to prevent production timers from starting
  process.env.NODE_ENV = 'test';
  
  // Mock console methods to reduce noise
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

// Clean up after each test
afterEach(() => {
  cleanup();
  
  // Restore console methods
  jest.restoreAllMocks();
});

// Final cleanup after all tests
afterAll(() => {
  cleanup();
  
  // Restore original timer functions
  global.setInterval = originalSetInterval;
  global.setTimeout = originalSetTimeout;
  global.clearInterval = originalClearInterval;
  global.clearTimeout = originalClearTimeout;
});

// Global error handler to catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Suppress deprecation warnings during tests
process.env.NODE_NO_WARNINGS = '1';