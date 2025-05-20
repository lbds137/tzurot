/**
 * Minimal, functional test for commandLoader bridge module
 */

// Create mocks directory
const mockProcessCommand = jest.fn().mockResolvedValue({ id: 'mock-result' });

// Mock dependencies
jest.mock('../../src/commands/index', () => ({
  processCommand: mockProcessCommand
}));

jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn()
}));

describe('Command Loader Bridge', () => {
  // Import commandLoader after mocks are set up
  const commandLoader = require('../../src/commandLoader');
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('should have a processCommand function', () => {
    expect(typeof commandLoader.processCommand).toBe('function');
  });
  
  it('should export the expected API', () => {
    expect(Object.keys(commandLoader)).toContain('processCommand');
  });
});