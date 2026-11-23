/**
 * Startup Utilities Tests
 *
 * Tests for AI worker initialization and validation functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock common-types before importing module
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: vi.fn(() => ({
      REDIS_URL: 'redis://localhost:6379',
      INTERNAL_SERVICE_SECRET: 'test-secret',
    })),
  };
});

// One shared logger instance so tests can assert the arguments the module logs.
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

vi.mock('./services/voice/VoiceEngineClient.js', () => ({
  getVoiceEngineClient: vi.fn(),
}));

import { HealthStatus } from '@tzurot/common-types/constants/service';
import { getVoiceEngineClient } from './services/voice/VoiceEngineClient.js';
import { validateRequiredEnvVars, buildHealthResponse, checkVoiceEngineHealth } from './startup.js';
import { snapshotEncryptionEnv } from './services/test-utils.js';

describe('Startup Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateRequiredEnvVars', () => {
    it('should not throw when all required vars are set', () => {
      const config = {
        REDIS_URL: 'redis://localhost:6379',
        INTERNAL_SERVICE_SECRET: 'test-secret',
      };
      expect(() =>
        validateRequiredEnvVars(
          config as ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>
        )
      ).not.toThrow();
    });

    it('should throw when REDIS_URL is undefined', () => {
      const config = {
        REDIS_URL: undefined,
        INTERNAL_SERVICE_SECRET: 'test-secret',
      };
      expect(() =>
        validateRequiredEnvVars(
          config as ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>
        )
      ).toThrow('REDIS_URL environment variable is required');
    });

    it('should throw when REDIS_URL is empty', () => {
      const config = {
        REDIS_URL: '',
        INTERNAL_SERVICE_SECRET: 'test-secret',
      };
      expect(() =>
        validateRequiredEnvVars(
          config as ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>
        )
      ).toThrow('REDIS_URL environment variable is required');
    });

    it('should throw when INTERNAL_SERVICE_SECRET is undefined', () => {
      const config = {
        REDIS_URL: 'redis://localhost:6379',
        INTERNAL_SERVICE_SECRET: undefined,
      };
      expect(() =>
        validateRequiredEnvVars(
          config as ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>
        )
      ).toThrow('INTERNAL_SERVICE_SECRET environment variable is required');
    });

    it('should throw when INTERNAL_SERVICE_SECRET is empty', () => {
      const config = {
        REDIS_URL: 'redis://localhost:6379',
        INTERNAL_SERVICE_SECRET: '',
      };
      expect(() =>
        validateRequiredEnvVars(
          config as ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>
        )
      ).toThrow('INTERNAL_SERVICE_SECRET environment variable is required');
    });
  });

  describe('validateRequiredEnvVars — API_KEY_ENCRYPTION_KEY', () => {
    type Cfg = ReturnType<typeof import('@tzurot/common-types/config/config').getConfig>;
    const base = { REDIS_URL: 'redis://localhost:6379', INTERNAL_SERVICE_SECRET: 'test-secret' };
    const restoreEncryptionEnv = snapshotEncryptionEnv();

    beforeEach(() => {
      // isEncryptionConfigured() reads process.env, not the config argument
      process.env.API_KEY_ENCRYPTION_KEY = 'a'.repeat(64);
      delete process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
      delete process.env.API_KEY_ENCRYPTION_KEY_NEXT;
    });

    afterEach(() => {
      restoreEncryptionEnv();
    });

    it('throws when deployed and the key is unset', () => {
      const config = { ...base, RAILWAY_ENVIRONMENT_NAME: 'production' };
      expect(() => validateRequiredEnvVars(config as Cfg)).toThrow(
        /API_KEY_ENCRYPTION_KEY.*cannot be decrypted.*requests would fail.*Railway/s
      );
    });

    it('does not throw when deployed and the key is set', () => {
      const config = {
        ...base,
        RAILWAY_ENVIRONMENT_NAME: 'production',
        API_KEY_ENCRYPTION_KEY: 'a'.repeat(64),
      };
      expect(() => validateRequiredEnvVars(config as Cfg)).not.toThrow();
    });

    it('does not throw on a local run (no RAILWAY_ENVIRONMENT_NAME) with the key unset', () => {
      expect(() => validateRequiredEnvVars(base as Cfg)).not.toThrow();
    });

    it('throws when deployed, the key is valid and API_KEY_ENCRYPTION_KEY_PREVIOUS is malformed', () => {
      process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS = 'not-hex';
      const config = {
        ...base,
        RAILWAY_ENVIRONMENT_NAME: 'production',
        API_KEY_ENCRYPTION_KEY: 'a'.repeat(64),
      };
      expect(() => validateRequiredEnvVars(config as Cfg)).toThrow(
        /API_KEY_ENCRYPTION_KEY.*PREVIOUS.*malformed.*cannot be decrypted.*requests would fail.*Railway/s
      );
    });

    it('throws when deployed, the key is valid and API_KEY_ENCRYPTION_KEY_NEXT is malformed', () => {
      process.env.API_KEY_ENCRYPTION_KEY_NEXT = 'not-hex';
      const config = {
        ...base,
        RAILWAY_ENVIRONMENT_NAME: 'production',
        API_KEY_ENCRYPTION_KEY: 'a'.repeat(64),
      };
      expect(() => validateRequiredEnvVars(config as Cfg)).toThrow(/NEXT.*malformed/s);
    });

    it('does not throw on a local run with a malformed API_KEY_ENCRYPTION_KEY_PREVIOUS', () => {
      process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS = 'not-hex';
      const config = { ...base, API_KEY_ENCRYPTION_KEY: 'a'.repeat(64) };
      expect(() => validateRequiredEnvVars(config as Cfg)).not.toThrow();
    });

    it('does not throw when deployed, the key is valid and no previous key is set', () => {
      const config = {
        ...base,
        RAILWAY_ENVIRONMENT_NAME: 'production',
        API_KEY_ENCRYPTION_KEY: 'a'.repeat(64),
      };
      expect(() => validateRequiredEnvVars(config as Cfg)).not.toThrow();
    });

    it('logs booleans for the rotation key slots once the primary key is configured', () => {
      process.env.API_KEY_ENCRYPTION_KEY_NEXT = 'c'.repeat(64);
      const config = { ...base, API_KEY_ENCRYPTION_KEY: 'a'.repeat(64) };
      validateRequiredEnvVars(config as Cfg);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ byokNextKeySet: true, byokPreviousKeySet: false }),
        'BYOK rotation key slots at startup'
      );
    });

    it('does not log the rotation key slots on a local run with no primary key', () => {
      validateRequiredEnvVars(base as Cfg);
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.anything(),
        'BYOK rotation key slots at startup'
      );
    });
  });

  describe('buildHealthResponse', () => {
    it('should return healthy status when both memory and worker are healthy', () => {
      const response = buildHealthResponse(true, true, false);

      expect(response.status).toBe(HealthStatus.Healthy);
      expect(response.memory).toBe(true);
      expect(response.worker).toBe(true);
      expect(response.timestamp).toBeDefined();
    });

    it('should return degraded status when memory is unhealthy', () => {
      const response = buildHealthResponse(false, true, false);

      expect(response.status).toBe(HealthStatus.Degraded);
      expect(response.memory).toBe(false);
      expect(response.worker).toBe(true);
    });

    it('should return degraded status when worker is unhealthy', () => {
      const response = buildHealthResponse(true, false, false);

      expect(response.status).toBe(HealthStatus.Degraded);
      expect(response.memory).toBe(true);
      expect(response.worker).toBe(false);
    });

    it('should return degraded status when both are unhealthy', () => {
      const response = buildHealthResponse(false, false, false);

      expect(response.status).toBe(HealthStatus.Degraded);
      expect(response.memory).toBe(false);
      expect(response.worker).toBe(false);
    });

    it('should return "disabled" for memory when memory is disabled', () => {
      const response = buildHealthResponse(true, true, true);

      expect(response.status).toBe(HealthStatus.Healthy);
      expect(response.memory).toBe('disabled');
      expect(response.worker).toBe(true);
    });

    it('should still be healthy when memory is disabled and worker is healthy', () => {
      const response = buildHealthResponse(true, true, true);

      expect(response.status).toBe(HealthStatus.Healthy);
    });

    it('should be degraded when memory is disabled but worker is unhealthy', () => {
      const response = buildHealthResponse(true, false, true);

      expect(response.status).toBe(HealthStatus.Degraded);
      expect(response.memory).toBe('disabled');
      expect(response.worker).toBe(false);
    });

    it('should include ISO timestamp', () => {
      const response = buildHealthResponse(true, true, false);

      // Verify it's a valid ISO date string
      expect(() => new Date(response.timestamp)).not.toThrow();
      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('checkVoiceEngineHealth', () => {
    it('should not throw when voice engine is not configured', async () => {
      vi.mocked(getVoiceEngineClient).mockReturnValue(null);

      await expect(checkVoiceEngineHealth()).resolves.toBeUndefined();
    });

    it('should not throw when voice engine is healthy', async () => {
      const mockClient = { getHealth: vi.fn().mockResolvedValue({ asr: true, tts: true }) };
      vi.mocked(getVoiceEngineClient).mockReturnValue(mockClient as never);

      await expect(checkVoiceEngineHealth()).resolves.toBeUndefined();
      expect(mockClient.getHealth).toHaveBeenCalled();
    });

    it('should not throw when voice engine is unhealthy', async () => {
      const mockClient = { getHealth: vi.fn().mockResolvedValue({ asr: true, tts: false }) };
      vi.mocked(getVoiceEngineClient).mockReturnValue(mockClient as never);

      await expect(checkVoiceEngineHealth()).resolves.toBeUndefined();
    });

    it('should not throw when health check throws', async () => {
      const mockClient = { getHealth: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
      vi.mocked(getVoiceEngineClient).mockReturnValue(mockClient as never);

      await expect(checkVoiceEngineHealth()).resolves.toBeUndefined();
    });
  });
});
