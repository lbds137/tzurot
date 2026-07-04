/**
 * Startup Utilities Tests
 *
 * Tests for bot-client initialization and validation functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock common-types before importing module
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: vi.fn(() => ({
      DISCORD_TOKEN: 'test-discord-token',
      REDIS_URL: 'redis://localhost:6379',
    })),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

import {
  validateDiscordToken,
  validateRedisUrl,
  validateInternalServiceSecret,
  getValidatedServiceSecret,
  logGatewayHealthStatus,
} from './startup.js';
import { getConfig } from '@tzurot/common-types/config/config';

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
        validateDiscordToken(
          config as ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>
        )
      ).not.toThrow();
    });

    it('should throw when DISCORD_TOKEN is undefined', () => {
      const config = {
        DISCORD_TOKEN: undefined,
      };
      expect(() =>
        validateDiscordToken(
          config as ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>
        )
      ).toThrow('DISCORD_TOKEN environment variable is required');
    });

    it('should throw when DISCORD_TOKEN is empty', () => {
      const config = {
        DISCORD_TOKEN: '',
      };
      expect(() =>
        validateDiscordToken(
          config as ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>
        )
      ).toThrow('DISCORD_TOKEN environment variable is required');
    });
  });

  describe('validateRedisUrl', () => {
    it('should not throw when REDIS_URL is set', () => {
      const config = {
        REDIS_URL: 'redis://localhost:6379',
      };
      expect(() =>
        validateRedisUrl(
          config as ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>
        )
      ).not.toThrow();
    });

    it('should throw when REDIS_URL is undefined', () => {
      const config = {
        REDIS_URL: undefined,
      };
      expect(() =>
        validateRedisUrl(
          config as ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>
        )
      ).toThrow('REDIS_URL environment variable is required');
    });

    it('should throw when REDIS_URL is empty', () => {
      const config = {
        REDIS_URL: '',
      };
      expect(() =>
        validateRedisUrl(
          config as ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>
        )
      ).toThrow('REDIS_URL environment variable is required');
    });
  });

  describe('validateInternalServiceSecret', () => {
    it('should not throw when INTERNAL_SERVICE_SECRET is set', () => {
      const config = {
        INTERNAL_SERVICE_SECRET: 'test-secret',
      };
      expect(() =>
        validateInternalServiceSecret(
          config as ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>
        )
      ).not.toThrow();
    });

    it('should throw when INTERNAL_SERVICE_SECRET is undefined', () => {
      const config = {
        INTERNAL_SERVICE_SECRET: undefined,
      };
      expect(() =>
        validateInternalServiceSecret(
          config as ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>
        )
      ).toThrow('INTERNAL_SERVICE_SECRET environment variable is required');
    });

    it('should throw when INTERNAL_SERVICE_SECRET is empty', () => {
      const config = {
        INTERNAL_SERVICE_SECRET: '',
      };
      expect(() =>
        validateInternalServiceSecret(
          config as ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>
        )
      ).toThrow('INTERNAL_SERVICE_SECRET environment variable is required');
    });
  });

  describe('getValidatedServiceSecret', () => {
    it('returns the secret when configured', () => {
      vi.mocked(getConfig).mockReturnValueOnce({
        INTERNAL_SERVICE_SECRET: 'production-secret-value',
      } as ReturnType<typeof getConfig>);

      expect(getValidatedServiceSecret()).toBe('production-secret-value');
    });

    it('throws when the secret is undefined', () => {
      vi.mocked(getConfig).mockReturnValueOnce({
        INTERNAL_SERVICE_SECRET: undefined,
      } as ReturnType<typeof getConfig>);

      expect(() => getValidatedServiceSecret()).toThrow('INTERNAL_SERVICE_SECRET not configured');
    });

    it('throws when the secret is empty string', () => {
      vi.mocked(getConfig).mockReturnValueOnce({
        INTERNAL_SERVICE_SECRET: '',
      } as ReturnType<typeof getConfig>);

      expect(() => getValidatedServiceSecret()).toThrow('INTERNAL_SERVICE_SECRET not configured');
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
