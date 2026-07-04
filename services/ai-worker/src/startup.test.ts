/**
 * Startup Utilities Tests
 *
 * Tests for AI worker initialization and validation functions.
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
      REDIS_URL: 'redis://localhost:6379',
      INTERNAL_SERVICE_SECRET: 'test-secret',
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

vi.mock('./services/voice/VoiceEngineClient.js', () => ({
  getVoiceEngineClient: vi.fn(),
}));

import { HealthStatus } from '@tzurot/common-types/constants/service';
import { getVoiceEngineClient } from './services/voice/VoiceEngineClient.js';
import { validateRequiredEnvVars, buildHealthResponse, checkVoiceEngineHealth } from './startup.js';

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
