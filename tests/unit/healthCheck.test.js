/**
 * Tests for the health check module
 */

const { formatUptime, getMemoryUsage, getSystemInfo } = require('../../src/healthCheck');

// Mock the client
jest.mock('../../src/bot', () => ({
  client: {
    isReady: jest.fn(),
    ws: { ping: 42 },
    guilds: {
      cache: {
        size: 5
      }
    },
    uptime: 3600000 // 1 hour in milliseconds
  }
}));

describe('Health Check Module', () => {
  describe('formatUptime', () => {
    test('formats uptime correctly', () => {
      // 1 day, 2 hours, 3 minutes, 4 seconds
      const uptimeInSeconds = 86400 + 7200 + 180 + 4;
      const formattedUptime = formatUptime(uptimeInSeconds);
      expect(formattedUptime).toBe('1d 2h 3m 4s');
    });

    test('handles zero values correctly', () => {
      const formattedUptime = formatUptime(0);
      expect(formattedUptime).toBe('0d 0h 0m 0s');
    });
  });

  describe('getMemoryUsage', () => {
    test('returns memory usage information', () => {
      const memoryUsage = getMemoryUsage();
      expect(memoryUsage).toHaveProperty('rss');
      expect(memoryUsage).toHaveProperty('heapTotal');
      expect(memoryUsage).toHaveProperty('heapUsed');
      expect(memoryUsage).toHaveProperty('external');
      expect(memoryUsage).toHaveProperty('memoryUsagePercent');
    });
  });

  describe('getSystemInfo', () => {
    test('returns system information', () => {
      const systemInfo = getSystemInfo();
      expect(systemInfo).toHaveProperty('platform');
      expect(systemInfo).toHaveProperty('arch');
      expect(systemInfo).toHaveProperty('nodeVersion');
      expect(systemInfo).toHaveProperty('cpuCores');
      expect(systemInfo).toHaveProperty('totalMemory');
      expect(systemInfo).toHaveProperty('freeMemory');
      expect(systemInfo).toHaveProperty('loadAverage');
    });
  });
});