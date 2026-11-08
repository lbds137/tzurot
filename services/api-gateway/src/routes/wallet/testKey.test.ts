/**
 * Tests for POST /wallet/test route
 *
 * Comprehensive tests for API key testing including validation,
 * decryption, and provider validation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock apiKeyValidation module
vi.mock('../../utils/apiKeyValidation.js', () => ({
  validateApiKey: vi.fn(),
}));

import { validateApiKey } from '../../utils/apiKeyValidation.js';
const mockValidateApiKey = vi.mocked(validateApiKey);

// Mock dependencies before imports
vi.mock('@tzurot/common-types/utils/encryption', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/encryption')>(
    '@tzurot/common-types/utils/encryption'
  );
  return {
    ...actual,
    decryptApiKey: vi.fn().mockReturnValue('decrypted-api-key'),
  };
});

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

import { decryptApiKey } from '@tzurot/common-types/utils/encryption';
import { undecryptableApiKeyMessage } from '@tzurot/common-types/utils/providerDisplayName';
const mockDecryptApiKey = vi.mocked(decryptApiKey);

// Uses the shared mock at `src/services/__mocks__/AuthMiddleware.ts`
// (auto-discovered by vitest). Passes `getOrCreateUserService` through to
// the real implementation and stubs `requireUserAuth` / `requireProvisionedUser`
// as passthrough middleware.
vi.mock('../../services/AuthMiddleware.js');

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

// Mock Prisma
const mockPrisma = {
  user: {
    findUnique: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    findFirst: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    update: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
  },
  userApiKey: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  $executeRaw: vi.fn().mockResolvedValue(1),
};

import { handleTestWalletKey } from './testKey.js';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { asRouteHandler } from '../../test/shared-route-test-utils.js';
import { makeUndecryptableCiphertext } from '../../test/undecryptableCiphertext.js';

// Helper to create mock request/response
function createMockReqRes(body: Record<string, unknown> = {}) {
  const req = {
    body,
    userId: 'discord-user-123',
    provisionedUserId: 'user-uuid-123',
    provisionedDefaultPersonaId: 'persona-uuid-default',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

// Helper to call the route handler directly
async function callHandler(
  prisma: unknown,
  req: Request & { userId: string },
  res: Response
): Promise<void> {
  const handler = asRouteHandler(handleTestWalletKey({ prisma: prisma as PrismaClient }));
  await handler(req, res);
}

describe('POST /api/user/wallet/test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiKey.mockResolvedValue({ valid: true, credits: 50 });
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
    mockPrisma.userApiKey.findFirst.mockResolvedValue({
      iv: 'mock-iv',
      content: 'mock-content',
      tag: 'mock-tag',
    });
    mockPrisma.userApiKey.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('validation', () => {
    it('should reject request with missing provider', async () => {
      const { req, res } = createMockReqRes({});

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should reject request with invalid provider', async () => {
      const { req, res } = createMockReqRes({ provider: 'invalid-provider' });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('provider'),
        })
      );
    });

    it('should reject null provider', async () => {
      const { req, res } = createMockReqRes({ provider: null });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('user and key lookup', () => {
    it('should return 404 when API key not found', async () => {
      mockPrisma.userApiKey.findFirst.mockResolvedValue(null);

      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('key decryption', () => {
    it('should decrypt stored key', async () => {
      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(mockDecryptApiKey).toHaveBeenCalledWith({
        iv: 'mock-iv',
        content: 'mock-content',
        tag: 'mock-tag',
      });
    });

    it('returns 401 with the undecryptable-key message when the stored API key cannot be decrypted', async () => {
      const realEncryption = await vi.importActual<
        typeof import('@tzurot/common-types/utils/encryption')
      >('@tzurot/common-types/utils/encryption');

      vi.stubEnv('API_KEY_ENCRYPTION_KEY', 'a'.repeat(64));
      vi.stubEnv('API_KEY_ENCRYPTION_KEY_PREVIOUS', undefined);

      const corruptedKey = makeUndecryptableCiphertext(
        realEncryption.encryptApiKey,
        'TEST-FIXTURE-not-a-real-provider-api-key-abcdef'
      );

      mockDecryptApiKey.mockImplementationOnce(realEncryption.decryptApiKey);
      mockPrisma.userApiKey.findFirst.mockResolvedValue(corruptedKey);

      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      const payload = vi.mocked(res.json).mock.calls[0][0] as { error: string; message: string };
      expect(payload.error).toBe('UNAUTHORIZED');
      expect(payload.message).toBe(undecryptableApiKeyMessage(AIProvider.OpenRouter));
      expect(mockValidateApiKey).not.toHaveBeenCalled();

      // Pins that the caught failure is the GCM auth-tag mismatch (the
      // fixture's actual failure mode), not a missing-encryption-key
      // config error that would also produce a caught `unknown` here.
      const loggedFields = mockLogger.warn.mock.calls[0][0] as { err: unknown };
      expect((loggedFields.err as Error).message).toBe(
        'Unsupported state or unable to authenticate data'
      );
    });

    it('lets a decrypt failure propagate instead of answering re-enter when the service itself is misconfigured', async () => {
      const realEncryption = await vi.importActual<
        typeof import('@tzurot/common-types/utils/encryption')
      >('@tzurot/common-types/utils/encryption');

      vi.stubEnv('API_KEY_ENCRYPTION_KEY', undefined);
      vi.stubEnv('API_KEY_ENCRYPTION_KEY_PREVIOUS', undefined);

      mockDecryptApiKey.mockImplementationOnce(realEncryption.decryptApiKey);
      mockPrisma.userApiKey.findFirst.mockResolvedValue({
        iv: 'mock-iv',
        content: 'mock-content',
        tag: 'mock-tag',
      });

      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await expect(callHandler(mockPrisma, req, res)).rejects.toThrow(
        'API_KEY_ENCRYPTION_KEY environment variable is required'
      );
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockValidateApiKey).not.toHaveBeenCalled();
    });
  });

  describe('key validation', () => {
    it('should validate decrypted key with provider', async () => {
      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(mockValidateApiKey).toHaveBeenCalledWith('decrypted-api-key', AIProvider.OpenRouter);
    });

    it('should return valid=false when key is invalid', async () => {
      mockValidateApiKey.mockResolvedValue({
        valid: false,
        error: 'Invalid API key',
        errorCode: 'INVALID_KEY',
      });

      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          valid: false,
          provider: AIProvider.OpenRouter,
          error: 'Invalid API key',
          errorCode: 'INVALID_KEY',
        })
      );
    });

    it('should forward a transient classification so consumers can distinguish it', async () => {
      mockValidateApiKey.mockResolvedValue({
        valid: false,
        error: 'HTTP 503',
        errorCode: 'UNKNOWN',
      });

      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          valid: false,
          errorCode: 'UNKNOWN',
        })
      );
    });

    it('should update lastUsedAt on successful validation', async () => {
      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(mockPrisma.userApiKey.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-uuid-123',
          provider: AIProvider.OpenRouter,
        },
        data: {
          lastUsedAt: expect.any(Date),
        },
      });
    });

    it('should return success with credits', async () => {
      mockValidateApiKey.mockResolvedValue({ valid: true, credits: 75.5 });

      const { req, res } = createMockReqRes({ provider: AIProvider.OpenRouter });

      await callHandler(mockPrisma, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          valid: true,
          provider: AIProvider.OpenRouter,
          credits: 75.5,
        })
      );
    });
  });
});
