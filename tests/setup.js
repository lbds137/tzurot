/**
 * Jest setup file to handle global test environment configuration
 * This file runs before each test file to set up proper mocking and cleanup
 */

// Set NODE_ENV to test environment
process.env.NODE_ENV = 'test';

// Store original timer functions
const originalSetInterval = global.setInterval;
const originalSetTimeout = global.setTimeout;
const originalClearInterval = global.clearInterval;
const originalClearTimeout = global.clearTimeout;

// Mock setInterval and setTimeout to prevent long-running timers in tests
// But allow short-term timers that tests might need
jest.spyOn(global, 'setInterval').mockImplementation((callback, delay, ...args) => {
  // For long delays (> 30 seconds), mock to prevent open handles
  if (delay > 30000) {
    const mockIntervalId = Math.floor(Math.random() * 1000);
    const mockInterval = {
      valueOf: () => mockIntervalId,
      unref: () => mockInterval,
      ref: () => mockInterval,
      hasRef: () => false,
      [Symbol.toPrimitive]: () => mockIntervalId
    };
    return mockInterval;
  }
  
  // For shorter delays, use real setInterval but track for cleanup
  const realInterval = originalSetInterval(callback, delay, ...args);
  return realInterval;
});

jest.spyOn(global, 'setTimeout').mockImplementation((callback, delay, ...args) => {
  // For long delays (> 30 seconds), mock to prevent open handles
  if (delay > 30000) {
    const mockTimeoutId = Math.floor(Math.random() * 1000);
    const mockTimeout = {
      valueOf: () => mockTimeoutId,
      unref: () => mockTimeout,
      ref: () => mockTimeout,
      hasRef: () => false,
      [Symbol.toPrimitive]: () => mockTimeoutId
    };
    return mockTimeout;
  }
  
  // For shorter delays, use real setTimeout
  return originalSetTimeout(callback, delay, ...args);
});

// Use real clear functions but make them safe for mocked timers
jest.spyOn(global, 'clearInterval').mockImplementation((id) => {
  // Try to clear real intervals, ignore errors for mock intervals
  try {
    return originalClearInterval(id);
  } catch (e) {
    // Ignore errors for mock intervals
  }
});

jest.spyOn(global, 'clearTimeout').mockImplementation((id) => {
  // Try to clear real timeouts, ignore errors for mock timeouts
  try {
    return originalClearTimeout(id);
  } catch (e) {
    // Ignore errors for mock timeouts
  }
});

// Track active timers for cleanup
const activeTimers = new Set();

// Enhanced setInterval tracking
const originalMockSetInterval = global.setInterval.getMockImplementation();
jest.spyOn(global, 'setInterval').mockImplementation((callback, delay, ...args) => {
  const result = originalMockSetInterval(callback, delay, ...args);
  // Track short-term real intervals for cleanup
  if (delay <= 30000 && typeof result === 'number') {
    activeTimers.add({ type: 'interval', id: result });
  }
  return result;
});

// Enhanced setTimeout tracking
const originalMockSetTimeout = global.setTimeout.getMockImplementation();
jest.spyOn(global, 'setTimeout').mockImplementation((callback, delay, ...args) => {
  const result = originalMockSetTimeout(callback, delay, ...args);
  // Track short-term real timeouts for cleanup
  if (delay <= 30000 && typeof result === 'number') {
    activeTimers.add({ type: 'timeout', id: result });
  }
  return result;
});

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
  // Clean up any active timers
  for (const timer of activeTimers) {
    try {
      if (timer.type === 'interval') {
        originalClearInterval(timer.id);
      } else if (timer.type === 'timeout') {
        originalClearTimeout(timer.id);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
  activeTimers.clear();
  
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