/**
 * Jest setup file to handle global test environment configuration
 * This file runs before each test file to set up proper mocking and cleanup
 */

// Set NODE_ENV to test environment
process.env.NODE_ENV = 'test';

// Set JEST_WORKER_ID if not already set (for singleton detection)
if (!process.env.JEST_WORKER_ID) {
  process.env.JEST_WORKER_ID = '1';
}

// Note: We now use jest.useFakeTimers() in beforeEach to handle all timer mocking
// This provides consistent timer behavior across all tests

// Set up test environment
beforeEach(() => {
  // Mock console methods to reduce noise
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

// Clean up after each test
afterEach(() => {
  
  // Restore console methods but keep our timer mocks
  console.log.mockRestore?.();
  console.warn.mockRestore?.();
  console.error.mockRestore?.();
  console.info.mockRestore?.();
  console.debug.mockRestore?.();
});

// Global error handler to catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Suppress deprecation warnings during tests
process.env.NODE_NO_WARNINGS = '1';

// Note: With fake timers enabled globally, tests should run much faster

// Helper to detect common timeout patterns in test code
global.detectTimeoutPatterns = (testFn) => {
  const fnString = testFn.toString();
  const patterns = [
    /setTimeout.*\d{4,}/,  // setTimeout with 4+ digit delays
    /new Promise.*setTimeout/,  // Promise with setTimeout
    /await.*Promise.*resolve.*setTimeout/  // Awaiting setTimeout promises
  ];
  
  for (const pattern of patterns) {
    if (pattern.test(fnString)) {
      console.warn('⚠️  Test contains timeout anti-pattern. Use jest.useFakeTimers()');
      break;
    }
  }
};