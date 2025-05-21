// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../config');

// Import the embedBuilders module that contains formatUptime
const { formatUptime } = require('../../../../src/utils/embedBuilders');

describe('Uptime Formatting Utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('correctly formats 0ms uptime', () => {
    const result = formatUptime(0);
    expect(result).toBe('0d 0h 0m 0s');
  });

  test('correctly formats 1 second uptime', () => {
    const result = formatUptime(1000);
    expect(result).toBe('0d 0h 0m 1s');
  });

  test('correctly formats 1 minute uptime', () => {
    const result = formatUptime(60 * 1000);
    expect(result).toBe('0d 0h 1m 0s');
  });

  test('correctly formats 1 hour uptime', () => {
    const result = formatUptime(60 * 60 * 1000);
    expect(result).toBe('0d 1h 0m 0s');
  });

  test('correctly formats 1 day uptime', () => {
    const result = formatUptime(24 * 60 * 60 * 1000);
    expect(result).toBe('1d 0h 0m 0s');
  });

  test('correctly formats mixed uptime values', () => {
    // 2 days, 5 hours, 30 minutes, 15 seconds
    const ms = (2 * 24 * 60 * 60 * 1000) + (5 * 60 * 60 * 1000) + (30 * 60 * 1000) + (15 * 1000);
    const result = formatUptime(ms);
    expect(result).toBe('2d 5h 30m 15s');
  });
});