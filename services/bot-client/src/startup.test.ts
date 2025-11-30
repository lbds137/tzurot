/**
 * Startup Utilities Tests
 *
 * Tests for bot-client initialization and validation functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock common-types before importing module
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      debug: vi.fn(),
    }),
    getConfig: vi.fn(() => ({
      DISCORD_TOKEN: 'test-discord-token',
      REDIS_URL: 'redis://localhost:6379',
    })),
  };
});

import { validateDiscordToken, validateRedisUrl, logGatewayHealthStatus } from './startup.js';

describe('Startup Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateDiscordToken', () => {
    it('should not throw when DISCORD_TOKEN is set', () => {
      const config = {
        DISCORD_TOKEN: 'valid-token',
      };
      expect(() =>
        validateDiscordToken(config as ReturnType<typeof import('@tzurot/common-types').getConfig>)
      ).not.toThrow();
    });

    it('should throw when DISCORD_TOKEN is undefined', () => {
      const config = {
        DISCORD_TOKEN: undefined,
      };
      expect(() =>
        validateDiscordToken(config as ReturnType<typeof import('@tzurot/common-types').getConfig>)
      ).toThrow('DISCORD_TOKEN environment variable is required');
    });

    it('should throw when DISCORD_TOKEN is empty', () => {
      const config = {
        DISCORD_TOKEN: '',
      };
      expect(() =>
        validateDiscordToken(config as ReturnType<typeof import('@tzurot/common-types').getConfig>)
      ).toThrow('DISCORD_TOKEN environment variable is required');
    });
  });

  describe('validateRedisUrl', () => {
    it('should not throw when REDIS_URL is set', () => {
      const config = {
        REDIS_URL: 'redis://localhost:6379',
      };
      expect(() =>
        validateRedisUrl(config as ReturnType<typeof import('@tzurot/common-types').getConfig>)
      ).not.toThrow();
    });

    it('should throw when REDIS_URL is undefined', () => {
      const config = {
        REDIS_URL: undefined,
      };
      expect(() =>
        validateRedisUrl(config as ReturnType<typeof import('@tzurot/common-types').getConfig>)
      ).toThrow('REDIS_URL environment variable is required');
    });

    it('should throw when REDIS_URL is empty', () => {
      const config = {
        REDIS_URL: '',
      };
      expect(() =>
        validateRedisUrl(config as ReturnType<typeof import('@tzurot/common-types').getConfig>)
      ).toThrow('REDIS_URL environment variable is required');
    });
  });

  describe('logGatewayHealthStatus', () => {
    it('should not throw when gateway is healthy', () => {
      expect(() => logGatewayHealthStatus(true)).not.toThrow();
    });

    it('should not throw when gateway is unhealthy', () => {
      expect(() => logGatewayHealthStatus(false)).not.toThrow();
    });

    it('should handle boolean false correctly', () => {
      // This test verifies the function handles unhealthy state gracefully
      expect(() => logGatewayHealthStatus(false)).not.toThrow();
    });

    it('should handle boolean true correctly', () => {
      // This test verifies the function handles healthy state gracefully
      expect(() => logGatewayHealthStatus(true)).not.toThrow();
    });
  });
});
