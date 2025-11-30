/**
 * Startup Utilities Tests
 *
 * Tests for server initialization and validation functions.
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
      debug: vi.fn(),
    }),
    getConfig: vi.fn(() => ({
      API_KEY_ENCRYPTION_KEY: undefined,
      REDIS_URL: 'redis://localhost:6379',
      DATABASE_URL: 'postgresql://localhost:5432/test',
      INTERNAL_SERVICE_SECRET: 'test-secret',
    })),
    HealthStatus: {
      Ok: 'ok',
      Error: 'error',
      Healthy: 'healthy',
      Degraded: 'degraded',
      Unhealthy: 'unhealthy',
    },
  };
});

// Mock fs/promises
vi.mock('fs/promises', () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
}));

import { access, mkdir, readdir } from 'fs/promises';
import { getConfig } from '@tzurot/common-types';

describe('Startup Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('validateByokConfiguration', () => {
    it('should not throw when encryption key is not configured (BYOK disabled)', async () => {
      vi.mocked(getConfig).mockReturnValue({
        API_KEY_ENCRYPTION_KEY: undefined,
      } as ReturnType<typeof getConfig>);

      const { validateByokConfiguration } = await import('./startup.js');
      expect(() => validateByokConfiguration()).not.toThrow();
    });

    it('should not throw when encryption key is empty (BYOK disabled)', async () => {
      vi.mocked(getConfig).mockReturnValue({
        API_KEY_ENCRYPTION_KEY: '',
      } as ReturnType<typeof getConfig>);

      const { validateByokConfiguration } = await import('./startup.js');
      expect(() => validateByokConfiguration()).not.toThrow();
    });

    it('should not throw when encryption key is valid 64-char hex', async () => {
      vi.mocked(getConfig).mockReturnValue({
        API_KEY_ENCRYPTION_KEY: 'a'.repeat(64),
      } as ReturnType<typeof getConfig>);

      const { validateByokConfiguration } = await import('./startup.js');
      expect(() => validateByokConfiguration()).not.toThrow();
    });

    it('should throw when encryption key is wrong length', async () => {
      vi.mocked(getConfig).mockReturnValue({
        API_KEY_ENCRYPTION_KEY: 'a'.repeat(32), // Too short
      } as ReturnType<typeof getConfig>);

      const { validateByokConfiguration } = await import('./startup.js');
      expect(() => validateByokConfiguration()).toThrow(/must be 64 hex characters/);
    });

    it('should throw when encryption key contains non-hex characters', async () => {
      vi.mocked(getConfig).mockReturnValue({
        API_KEY_ENCRYPTION_KEY: 'g'.repeat(64), // 'g' is not hex
      } as ReturnType<typeof getConfig>);

      const { validateByokConfiguration } = await import('./startup.js');
      expect(() => validateByokConfiguration()).toThrow(/must contain only hexadecimal/);
    });
  });

  describe('ensureAvatarDirectory', () => {
    it('should succeed when directory exists', async () => {
      vi.mocked(access).mockResolvedValue(undefined);

      const { ensureAvatarDirectory } = await import('./startup.js');
      await expect(ensureAvatarDirectory()).resolves.toBeUndefined();
      expect(mkdir).not.toHaveBeenCalled();
    });

    it('should create directory when it does not exist', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(mkdir).mockResolvedValue(undefined);

      const { ensureAvatarDirectory } = await import('./startup.js');
      await expect(ensureAvatarDirectory()).resolves.toBeUndefined();
      expect(mkdir).toHaveBeenCalledWith('/data/avatars', { recursive: true });
    });

    it('should throw when directory creation fails', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(mkdir).mockRejectedValue(new Error('Permission denied'));

      const { ensureAvatarDirectory } = await import('./startup.js');
      await expect(ensureAvatarDirectory()).rejects.toThrow('Permission denied');
    });
  });

  describe('ensureTempAttachmentDirectory', () => {
    it('should succeed when directory exists', async () => {
      vi.mocked(access).mockResolvedValue(undefined);

      const { ensureTempAttachmentDirectory } = await import('./startup.js');
      await expect(ensureTempAttachmentDirectory()).resolves.toBeUndefined();
      expect(mkdir).not.toHaveBeenCalled();
    });

    it('should create directory when it does not exist', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(mkdir).mockResolvedValue(undefined);

      const { ensureTempAttachmentDirectory } = await import('./startup.js');
      await expect(ensureTempAttachmentDirectory()).resolves.toBeUndefined();
      expect(mkdir).toHaveBeenCalledWith('/data/temp-attachments', { recursive: true });
    });
  });

  describe('checkAvatarStorage', () => {
    it('should return Ok status with file count when directory is accessible', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readdir).mockResolvedValue(['avatar1.png', 'avatar2.png'] as unknown as Awaited<
        ReturnType<typeof readdir>
      >);

      const { checkAvatarStorage } = await import('./startup.js');
      const result = await checkAvatarStorage();

      expect(result.status).toBe('ok');
      expect(result.count).toBe(2);
      expect(result.error).toBeUndefined();
    });

    it('should return Error status when directory is not accessible', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const { checkAvatarStorage } = await import('./startup.js');
      const result = await checkAvatarStorage();

      expect(result.status).toBe('error');
      expect(result.error).toBe('ENOENT: no such file or directory');
      expect(result.count).toBeUndefined();
    });
  });

  describe('validateRequiredEnvVars', () => {
    it('should not throw when all required env vars are set', async () => {
      vi.mocked(getConfig).mockReturnValue({
        REDIS_URL: 'redis://localhost:6379',
        DATABASE_URL: 'postgresql://localhost:5432/test',
      } as ReturnType<typeof getConfig>);

      const { validateRequiredEnvVars } = await import('./startup.js');
      expect(() => validateRequiredEnvVars()).not.toThrow();
    });

    it('should throw when REDIS_URL is missing', async () => {
      vi.mocked(getConfig).mockReturnValue({
        REDIS_URL: undefined,
        DATABASE_URL: 'postgresql://localhost:5432/test',
      } as ReturnType<typeof getConfig>);

      const { validateRequiredEnvVars } = await import('./startup.js');
      expect(() => validateRequiredEnvVars()).toThrow('REDIS_URL environment variable is required');
    });

    it('should throw when DATABASE_URL is missing', async () => {
      vi.mocked(getConfig).mockReturnValue({
        REDIS_URL: 'redis://localhost:6379',
        DATABASE_URL: undefined,
      } as ReturnType<typeof getConfig>);

      const { validateRequiredEnvVars } = await import('./startup.js');
      expect(() => validateRequiredEnvVars()).toThrow(
        'DATABASE_URL environment variable is required'
      );
    });
  });

  describe('validateServiceAuthConfig', () => {
    it('should not throw when service secret is configured', async () => {
      vi.mocked(getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: 'test-secret',
      } as ReturnType<typeof getConfig>);

      const { validateServiceAuthConfig } = await import('./startup.js');
      expect(() => validateServiceAuthConfig()).not.toThrow();
    });

    it('should not throw when service secret is missing (just logs warning)', async () => {
      vi.mocked(getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: undefined,
      } as ReturnType<typeof getConfig>);

      const { validateServiceAuthConfig } = await import('./startup.js');
      expect(() => validateServiceAuthConfig()).not.toThrow();
    });
  });
});
