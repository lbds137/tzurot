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

// Mock heavy DDD modules to prevent cascade loading
// These modules import many dependencies and slow down tests
jest.mock('../src/application/bootstrap/ApplicationBootstrap', () => ({
  ApplicationBootstrap: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    shutdown: jest.fn().mockResolvedValue(undefined),
    initialized: false,
  })),
  getApplicationBootstrap: jest.fn(),
  resetApplicationBootstrap: jest.fn(),
}));

jest.mock('../src/adapters/persistence/FilePersonalityRepository', () => ({
  FilePersonalityRepository: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue(null),
    findByName: jest.fn().mockResolvedValue(null),
    findByNameOrAlias: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue(true),
    remove: jest.fn().mockResolvedValue(true),
    findAll: jest.fn().mockResolvedValue([]),
    findByOwner: jest.fn().mockResolvedValue([]),
    getStatistics: jest
      .fn()
      .mockResolvedValue({ totalPersonalities: 0, totalAliases: 0, owners: 0 }),
  })),
}));

jest.mock('../src/application/services/PersonalityApplicationService', () => ({
  PersonalityApplicationService: jest.fn().mockImplementation(() => ({
    registerPersonality: jest.fn().mockResolvedValue({}),
    getPersonality: jest.fn().mockResolvedValue(null),
    listPersonalitiesByOwner: jest.fn().mockResolvedValue([]),
    addAlias: jest.fn().mockResolvedValue({}),
    removePersonality: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('../src/adapters/ai/HttpAIServiceAdapter', () => ({
  HttpAIServiceAdapter: jest.fn().mockImplementation(() => ({
    sendRequest: jest.fn().mockResolvedValue({}),
    initialize: jest.fn().mockResolvedValue(undefined),
    isHealthy: jest.fn().mockResolvedValue(true),
  })),
}));

// Mock the heavy webhook manager that loads many dependencies
jest.mock('../src/webhookManager', () => ({
  getOrCreateWebhook: jest.fn().mockResolvedValue({}),
  sendWebhookMessage: jest.fn().mockResolvedValue({}),
  sendAsUser: jest.fn().mockResolvedValue({}),
  handleError: jest.fn(),
}));

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
global.detectTimeoutPatterns = testFn => {
  const fnString = testFn.toString();
  const patterns = [
    /setTimeout.*\d{4,}/, // setTimeout with 4+ digit delays
    /new Promise.*setTimeout/, // Promise with setTimeout
    /await.*Promise.*resolve.*setTimeout/, // Awaiting setTimeout promises
  ];

  for (const pattern of patterns) {
    if (pattern.test(fnString)) {
      console.warn('⚠️  Test contains timeout anti-pattern. Use jest.useFakeTimers()');
      break;
    }
  }
};
