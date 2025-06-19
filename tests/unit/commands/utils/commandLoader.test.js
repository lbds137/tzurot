/**
 * Tests for commandLoader utility
 *
 * Note: This module is difficult to test fully due to its interaction with
 * Node.js's module system. See /docs/COMMANDLOADER_TEST_APPROACH.md for details.
 */

// Mock dependencies
jest.mock('fs');
jest.mock('path');
jest.mock('../../../../src/logger');
jest.mock('../../../../src/commands/utils/commandRegistry');

// Import mocked modules
const fs = require('fs');
const logger = require('../../../../src/logger');

describe('Command Loader Utility', () => {
  // Import module after mocks are set up
  const commandLoader = require('../../../../src/commands/utils/commandLoader');

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock filesystem to return empty directory
    fs.readdirSync = jest.fn().mockReturnValue([]);

    // Configure logger
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.debug = jest.fn();
    logger.warn = jest.fn();
  });

  it('should export a loadCommands function', () => {
    expect(typeof commandLoader.loadCommands).toBe('function');
  });

  it('should return a result object with the expected shape', () => {
    // Call loadCommands
    const result = commandLoader.loadCommands();

    // Assert on the shape of the result
    expect(result).toEqual({
      loaded: expect.any(Array),
      failed: expect.any(Array),
      count: expect.any(Number),
    });
  });
});
