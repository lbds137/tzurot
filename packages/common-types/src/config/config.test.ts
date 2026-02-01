/**
 * Tests for Config module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig, resetConfig, createTestConfig, validateEnv, envSchema } from './config.js';
import { AIProvider } from '../constants/index.js';

describe('config', () => {
  // Store original process.env
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfig();
    // Reset to minimal valid env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    resetConfig();
    process.env = originalEnv;
  });

  describe('createTestConfig', () => {
    it('should return default test config', () => {
      const config = createTestConfig();

      expect(config.NODE_ENV).toBe('test');
      expect(config.LOG_LEVEL).toBe('error');
      expect(config.AI_PROVIDER).toBe(AIProvider.OpenRouter);
      expect(config.ENABLE_HEALTH_SERVER).toBe(false);
      expect(config.BOT_MENTION_CHAR).toBe('@');
    });

    it('should allow overrides', () => {
      const config = createTestConfig({
        LOG_LEVEL: 'debug',
        NODE_ENV: 'development',
        BOT_OWNER_ID: '123456789',
      });

      expect(config.LOG_LEVEL).toBe('debug');
      expect(config.NODE_ENV).toBe('development');
      expect(config.BOT_OWNER_ID).toBe('123456789');
    });

    it('should not read from process.env', () => {
      process.env.LOG_LEVEL = 'trace';
      process.env.BOT_OWNER_ID = '999999999';

      const config = createTestConfig();

      // Should use test defaults, not process.env
      expect(config.LOG_LEVEL).toBe('error');
      expect(config.BOT_OWNER_ID).toBeUndefined();
    });

    it('should include all required fields', () => {
      const config = createTestConfig();

      // Check some key fields exist
      expect(config).toHaveProperty('DISCORD_TOKEN');
      expect(config).toHaveProperty('DATABASE_URL');
      expect(config).toHaveProperty('REDIS_URL');
      expect(config).toHaveProperty('API_GATEWAY_PORT');
      expect(config).toHaveProperty('GATEWAY_URL');
      expect(config).toHaveProperty('CORS_ORIGINS');
      expect(config).toHaveProperty('WORKER_CONCURRENCY');
    });
  });

  describe('resetConfig', () => {
    it('should clear cached config', () => {
      // First call caches
      const config1 = getConfig();

      // Change env
      process.env.LOG_LEVEL = 'trace';

      // Without reset, should return cached
      const config2 = getConfig();
      expect(config2).toBe(config1);

      // After reset, should re-validate
      resetConfig();
      const config3 = getConfig();
      expect(config3).not.toBe(config1);
      expect(config3.LOG_LEVEL).toBe('trace');
    });
  });

  describe('getConfig', () => {
    it('should cache config on subsequent calls', () => {
      const config1 = getConfig();
      const config2 = getConfig();

      expect(config1).toBe(config2); // Same reference
    });

    it('should use defaults for optional fields', () => {
      const config = getConfig();

      expect(config.BOT_MENTION_CHAR).toBe('@');
      expect(config.AI_PROVIDER).toBe(AIProvider.OpenRouter);
      expect(config.NODE_ENV).toBeDefined();
    });
  });

  describe('envSchema', () => {
    it('should transform empty strings to undefined for optional fields', () => {
      const result = envSchema.parse({
        DISCORD_TOKEN: '',
        BOT_OWNER_ID: '',
      });

      expect(result.DISCORD_TOKEN).toBeUndefined();
      expect(result.BOT_OWNER_ID).toBeUndefined();
    });

    it('should validate Discord IDs as all digits', () => {
      expect(() =>
        envSchema.parse({
          BOT_OWNER_ID: 'not-digits',
        })
      ).toThrow();

      const result = envSchema.parse({
        BOT_OWNER_ID: '123456789012345678',
      });
      expect(result.BOT_OWNER_ID).toBe('123456789012345678');
    });

    it('should validate LOG_LEVEL enum', () => {
      expect(() =>
        envSchema.parse({
          LOG_LEVEL: 'invalid',
        })
      ).toThrow();

      const result = envSchema.parse({
        LOG_LEVEL: 'debug',
      });
      expect(result.LOG_LEVEL).toBe('debug');
    });

    it('should validate NODE_ENV enum', () => {
      expect(() =>
        envSchema.parse({
          NODE_ENV: 'staging',
        })
      ).toThrow();

      const result = envSchema.parse({
        NODE_ENV: 'production',
      });
      expect(result.NODE_ENV).toBe('production');
    });

    it('should transform CORS_ORIGINS from comma-separated string', () => {
      const result = envSchema.parse({
        CORS_ORIGINS: 'http://localhost:3000,http://localhost:5000',
      });

      expect(result.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:5000']);
    });

    it('should default CORS_ORIGINS to wildcard', () => {
      const result = envSchema.parse({});

      expect(result.CORS_ORIGINS).toEqual(['*']);
    });

    it('should validate encryption key format (64 hex chars)', () => {
      const validKey = 'a'.repeat(64);
      const result = envSchema.parse({
        API_KEY_ENCRYPTION_KEY: validKey,
      });
      expect(result.API_KEY_ENCRYPTION_KEY).toBe(validKey);

      expect(() =>
        envSchema.parse({
          API_KEY_ENCRYPTION_KEY: 'too-short',
        })
      ).toThrow();

      expect(() =>
        envSchema.parse({
          API_KEY_ENCRYPTION_KEY: 'g'.repeat(64), // 'g' is not hex
        })
      ).toThrow();
    });

    it('should transform numeric string fields to numbers', () => {
      const result = envSchema.parse({
        REDIS_PORT: '6380',
        API_GATEWAY_PORT: '4000',
        WORKER_CONCURRENCY: '10',
        PORT: '8080',
      });

      expect(result.REDIS_PORT).toBe(6380);
      expect(result.API_GATEWAY_PORT).toBe(4000);
      expect(result.WORKER_CONCURRENCY).toBe(10);
      expect(result.PORT).toBe(8080);
    });

    it('should transform ENABLE_HEALTH_SERVER correctly', () => {
      const enabled = envSchema.parse({ ENABLE_HEALTH_SERVER: 'true' });
      expect(enabled.ENABLE_HEALTH_SERVER).toBe(true);

      const disabled = envSchema.parse({ ENABLE_HEALTH_SERVER: 'false' });
      expect(disabled.ENABLE_HEALTH_SERVER).toBe(false);

      // Any non-'false' value is truthy
      const other = envSchema.parse({ ENABLE_HEALTH_SERVER: 'yes' });
      expect(other.ENABLE_HEALTH_SERVER).toBe(true);
    });
  });

  describe('validateEnv', () => {
    it('should throw descriptive error on validation failure', () => {
      process.env.LOG_LEVEL = 'invalid-level';

      expect(() => validateEnv()).toThrow('Environment validation failed');
      expect(() => validateEnv()).toThrow('LOG_LEVEL');
    });

    it('should return valid config on success', () => {
      process.env.LOG_LEVEL = 'info';
      process.env.NODE_ENV = 'development';

      const config = validateEnv();

      expect(config.LOG_LEVEL).toBe('info');
      expect(config.NODE_ENV).toBe('development');
    });
  });
});
