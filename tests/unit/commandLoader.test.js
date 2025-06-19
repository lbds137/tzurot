/**
 * Tests for commandLoader bridge module
 *
 * Note: This module is difficult to test fully due to its interaction with
 * Node.js's module system. See /docs/COMMANDLOADER_TEST_APPROACH.md for details.
 */

// Mock dependencies before requiring the module
jest.mock('../../src/commands/index', () => ({
  processCommand: jest.fn().mockResolvedValue({ id: 'mock-result' }),
}));

jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('Command Loader Bridge', () => {
  // Import dependencies and module after mocking
  const commandLoader = require('../../src/commandLoader');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should export a processCommand function', () => {
    expect(typeof commandLoader.processCommand).toBe('function');
  });

  it('should have the expected API', () => {
    expect(Object.keys(commandLoader)).toContain('processCommand');
  });
});
