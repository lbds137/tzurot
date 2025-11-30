/**
 * Startup Utilities Tests
 *
 * Tests for AI worker initialization and validation functions.
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
      REDIS_URL: 'redis://localhost:6379',
      OPENAI_API_KEY: 'test-openai-key',
    })),
    HealthStatus: actual.HealthStatus,
  };
});

import { HealthStatus } from '@tzurot/common-types';
import {
  validateRequiredEnvVars,
  validateAIConfig,
  buildHealthResponse,
} from './startup.js';

describe('Startup Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateRequiredEnvVars', () => {
    it('should not throw when REDIS_URL is set', () => {
      const config = {
        REDIS_URL: 'redis://localhost:6379',
      };
      expect(() => validateRequiredEnvVars(config as ReturnType<typeof import('@tzurot/common-types').getConfig>)).not.toThrow();
    });

    it('should throw when REDIS_URL is undefined', () => {
      const config = {
        REDIS_URL: undefined,
      };
      expect(() => validateRequiredEnvVars(config as ReturnType<typeof import('@tzurot/common-types').getConfig>)).toThrow(
        'REDIS_URL environment variable is required'
      );
    });

    it('should throw when REDIS_URL is empty', () => {
      const config = {
        REDIS_URL: '',
      };
      expect(() => validateRequiredEnvVars(config as ReturnType<typeof import('@tzurot/common-types').getConfig>)).toThrow(
        'REDIS_URL environment variable is required'
      );
    });
  });

  describe('validateAIConfig', () => {
    it('should not throw when OPENAI_API_KEY is set', () => {
      const config = {
        OPENAI_API_KEY: 'test-key',
      };
      expect(() => validateAIConfig(config as ReturnType<typeof import('@tzurot/common-types').getConfig>)).not.toThrow();
    });

    it('should throw when OPENAI_API_KEY is undefined', () => {
      const config = {
        OPENAI_API_KEY: undefined,
      };
      expect(() => validateAIConfig(config as ReturnType<typeof import('@tzurot/common-types').getConfig>)).toThrow(
        'OPENAI_API_KEY environment variable is required for memory embeddings'
      );
    });

    it('should throw when OPENAI_API_KEY is empty', () => {
      const config = {
        OPENAI_API_KEY: '',
      };
      expect(() => validateAIConfig(config as ReturnType<typeof import('@tzurot/common-types').getConfig>)).toThrow(
        'OPENAI_API_KEY environment variable is required for memory embeddings'
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
});
