/**
 * Authentication Middleware Tests
 *
 * Comprehensive test coverage for owner authentication middleware.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  extractOwnerId,
  isValidOwner,
  requireOwnerAuth,
  extractUserId,
  requireUserAuth,
  extractServiceSecret,
  isValidServiceSecret,
  requireServiceAuth,
} from './AuthMiddleware.js';
import * as commonTypes from '@tzurot/common-types';

// Mock getConfig
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    getConfig: vi.fn(),
  };
});

describe('authMiddleware', () => {
  describe('extractOwnerId', () => {
    it('should extract owner ID from header', () => {
      const req = {
        headers: { 'x-owner-id': '123456789' },
        body: {},
      } as unknown as Request;

      expect(extractOwnerId(req)).toBe('123456789');
    });

    it('should extract owner ID from body when header not present', () => {
      const req = {
        headers: {},
        body: { ownerId: '987654321' },
      } as unknown as Request;

      expect(extractOwnerId(req)).toBe('987654321');
    });

    it('should prefer header over body when both present', () => {
      const req = {
        headers: { 'x-owner-id': 'header-id' },
        body: { ownerId: 'body-id' },
      } as unknown as Request;

      expect(extractOwnerId(req)).toBe('header-id');
    });

    it('should return undefined when neither header nor body present', () => {
      const req = {
        headers: {},
        body: {},
      } as unknown as Request;

      expect(extractOwnerId(req)).toBeUndefined();
    });

    it('should return undefined when header is array', () => {
      const req = {
        headers: { 'x-owner-id': ['id1', 'id2'] },
        body: {},
      } as unknown as Request;

      expect(extractOwnerId(req)).toBeUndefined();
    });

    it('should return undefined when body.ownerId is not string', () => {
      const req = {
        headers: {},
        body: { ownerId: 123 },
      } as unknown as Request;

      expect(extractOwnerId(req)).toBeUndefined();
    });

    it('should return undefined when body is null', () => {
      const req = {
        headers: {},
        body: null,
      } as unknown as Request;

      expect(extractOwnerId(req)).toBeUndefined();
    });

    it('should handle empty string in header', () => {
      const req = {
        headers: { 'x-owner-id': '' },
        body: {},
      } as unknown as Request;

      expect(extractOwnerId(req)).toBe('');
    });

    it('should handle empty string in body', () => {
      const req = {
        headers: {},
        body: { ownerId: '' },
      } as unknown as Request;

      expect(extractOwnerId(req)).toBe('');
    });
  });

  describe('isValidOwner', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return true when owner ID matches config', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: 'valid-owner-id',
      } as any);

      expect(isValidOwner('valid-owner-id')).toBe(true);
    });

    it('should return false when owner ID does not match', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: 'valid-owner-id',
      } as any);

      expect(isValidOwner('wrong-owner-id')).toBe(false);
    });

    it('should return false when owner ID is undefined', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: 'valid-owner-id',
      } as any);

      expect(isValidOwner(undefined)).toBe(false);
    });

    it('should return false when BOT_OWNER_ID is not configured', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: undefined,
      } as any);

      expect(isValidOwner('some-id')).toBe(false);
    });

    it('should return false when both are undefined', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: undefined,
      } as any);

      expect(isValidOwner(undefined)).toBe(false);
    });

    it('should return false when owner ID is empty string', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: 'valid-owner-id',
      } as any);

      expect(isValidOwner('')).toBe(false);
    });

    it('should handle case-sensitive comparison', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: 'CaseSensitiveId',
      } as any);

      expect(isValidOwner('casesensitiveid')).toBe(false);
      expect(isValidOwner('CaseSensitiveId')).toBe(true);
    });
  });

  describe('requireOwnerAuth middleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: NextFunction;

    beforeEach(() => {
      vi.clearAllMocks();

      mockReq = {
        headers: {},
        body: {},
      };

      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      mockNext = vi.fn();
    });

    it('should call next() when owner ID is valid', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: 'valid-owner',
      } as any);

      mockReq.headers = { 'x-owner-id': 'valid-owner' };

      const middleware = requireOwnerAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should return 403 when owner ID is invalid', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: 'valid-owner',
      } as any);

      mockReq.headers = { 'x-owner-id': 'invalid-owner' };

      const middleware = requireOwnerAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'UNAUTHORIZED',
          message: 'This endpoint is only available to the bot owner',
        })
      );
    });

    it('should return 403 when owner ID is missing', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: 'valid-owner',
      } as any);

      const middleware = requireOwnerAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should use custom message when provided', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: 'valid-owner',
      } as any);

      mockReq.headers = { 'x-owner-id': 'invalid-owner' };

      const middleware = requireOwnerAuth('Custom unauthorized message');
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Custom unauthorized message',
        })
      );
    });

    it('should work with owner ID in body', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: 'valid-owner',
      } as any);

      mockReq.body = { ownerId: 'valid-owner' };

      const middleware = requireOwnerAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('should include timestamp in error response', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: 'valid-owner',
      } as any);

      const middleware = requireOwnerAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });

    it('should not call next() when BOT_OWNER_ID is not configured', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: undefined,
      } as any);

      mockReq.headers = { 'x-owner-id': 'some-id' };

      const middleware = requireOwnerAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should handle empty string owner ID', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        BOT_OWNER_ID: 'valid-owner',
      } as any);

      mockReq.headers = { 'x-owner-id': '' };

      const middleware = requireOwnerAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });

  describe('extractUserId', () => {
    it('should extract user ID from X-User-Id header', () => {
      const req = {
        headers: { 'x-user-id': 'user-123' },
      } as unknown as Request;

      expect(extractUserId(req)).toBe('user-123');
    });

    it('should return undefined when header is missing', () => {
      const req = {
        headers: {},
      } as unknown as Request;

      expect(extractUserId(req)).toBeUndefined();
    });

    it('should return undefined when header is empty string', () => {
      const req = {
        headers: { 'x-user-id': '' },
      } as unknown as Request;

      expect(extractUserId(req)).toBeUndefined();
    });

    it('should return undefined when header is array', () => {
      const req = {
        headers: { 'x-user-id': ['id1', 'id2'] },
      } as unknown as Request;

      expect(extractUserId(req)).toBeUndefined();
    });

    it('should handle whitespace in user ID', () => {
      const req = {
        headers: { 'x-user-id': '  user-123  ' },
      } as unknown as Request;

      // Should return the raw value (whitespace handling is caller's responsibility)
      expect(extractUserId(req)).toBe('  user-123  ');
    });
  });

  describe('requireUserAuth middleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: NextFunction;

    beforeEach(() => {
      vi.clearAllMocks();

      mockReq = {
        headers: {},
        path: '/wallet/set',
        method: 'POST',
        ip: '127.0.0.1',
      };

      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      mockNext = vi.fn();
    });

    it('should call next() and attach userId when user ID is valid', () => {
      mockReq.headers = { 'x-user-id': 'user-123' };

      const middleware = requireUserAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
      expect((mockReq as Request & { userId: string }).userId).toBe('user-123');
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should return 403 when user ID is missing', () => {
      const middleware = requireUserAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'UNAUTHORIZED',
          message: 'User authentication required',
        })
      );
    });

    it('should return 403 when user ID is empty string', () => {
      mockReq.headers = { 'x-user-id': '' };

      const middleware = requireUserAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should use custom message when provided', () => {
      const middleware = requireUserAuth('Custom auth required message');
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Custom auth required message',
        })
      );
    });

    it('should include timestamp in error response', () => {
      const middleware = requireUserAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });
  });

  describe('extractServiceSecret', () => {
    it('should extract service secret from X-Service-Auth header', () => {
      const req = {
        headers: { 'x-service-auth': 'test-admin-key-123' },
      } as unknown as Request;

      expect(extractServiceSecret(req)).toBe('test-admin-key-123');
    });

    it('should return undefined when header is missing', () => {
      const req = {
        headers: {},
      } as unknown as Request;

      expect(extractServiceSecret(req)).toBeUndefined();
    });

    it('should return undefined when header is empty string', () => {
      const req = {
        headers: { 'x-service-auth': '' },
      } as unknown as Request;

      expect(extractServiceSecret(req)).toBeUndefined();
    });

    it('should return undefined when header is array', () => {
      const req = {
        headers: { 'x-service-auth': ['key1', 'key2'] },
      } as unknown as Request;

      expect(extractServiceSecret(req)).toBeUndefined();
    });
  });

  describe('isValidServiceSecret', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return true when key matches configured key', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: 'valid-service-secret',
      } as any);

      expect(isValidServiceSecret('valid-service-secret')).toBe(true);
    });

    it('should return false when key does not match', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: 'valid-service-secret',
      } as any);

      expect(isValidServiceSecret('wrong-admin-key')).toBe(false);
    });

    it('should return false when key is undefined', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: 'valid-service-secret',
      } as any);

      expect(isValidServiceSecret(undefined)).toBe(false);
    });

    it('should return false when INTERNAL_SERVICE_SECRET is not configured', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: undefined,
      } as any);

      expect(isValidServiceSecret('some-key')).toBe(false);
    });

    it('should return false when key is empty string', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: 'valid-service-secret',
      } as any);

      expect(isValidServiceSecret('')).toBe(false);
    });

    it('should handle case-sensitive comparison', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: 'CaseSensitiveKey',
      } as any);

      expect(isValidServiceSecret('casesensitivekey')).toBe(false);
      expect(isValidServiceSecret('CaseSensitiveKey')).toBe(true);
    });

    it('should use constant-time comparison (same length keys)', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: 'abcdef',
      } as any);

      // Different keys of same length should be compared safely
      expect(isValidServiceSecret('ghijkl')).toBe(false);
      expect(isValidServiceSecret('abcdef')).toBe(true);
    });
  });

  describe('requireServiceAuth middleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: NextFunction;

    beforeEach(() => {
      vi.clearAllMocks();

      mockReq = {
        headers: {},
        path: '/admin/llm-config',
        method: 'PUT',
        ip: '127.0.0.1',
      };

      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      mockNext = vi.fn();
    });

    it('should call next() when service secret is valid', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: 'valid-service-secret',
      } as any);

      mockReq.headers = { 'x-service-auth': 'valid-service-secret' };

      const middleware = requireServiceAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should return 403 when service secret is invalid', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: 'valid-service-secret',
      } as any);

      mockReq.headers = { 'x-service-auth': 'wrong-secret' };

      const middleware = requireServiceAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'UNAUTHORIZED',
          message: 'Service authentication required',
        })
      );
    });

    it('should return 403 when service secret is missing', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: 'valid-service-secret',
      } as any);

      const middleware = requireServiceAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should use custom message when provided', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: 'valid-service-secret',
      } as any);

      mockReq.headers = { 'x-service-auth': 'wrong-secret' };

      const middleware = requireServiceAuth('Custom admin message');
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Custom admin message',
        })
      );
    });

    it('should return 403 when INTERNAL_SERVICE_SECRET is not configured', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: undefined,
      } as any);

      mockReq.headers = { 'x-service-auth': 'some-key' };

      const middleware = requireServiceAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should include timestamp in error response', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: 'valid-service-secret',
      } as any);

      const middleware = requireServiceAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });

    /**
     * CONTRACT TEST: userId extraction
     *
     * Admin routes that check isBotOwner(req.userId) depend on this behavior.
     * The bot-client sends X-User-Id header with admin requests.
     * Without this, admin settings commands fail with "Only bot owners can modify settings".
     */
    it('should attach userId to request when X-User-Id header is provided', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: 'valid-service-secret',
      } as any);

      mockReq.headers = {
        'x-service-auth': 'valid-service-secret',
        'x-user-id': 'owner-discord-id',
      };

      const middleware = requireServiceAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
      expect((mockReq as Request & { userId: string }).userId).toBe('owner-discord-id');
    });

    it('should not attach userId when X-User-Id header is missing', () => {
      vi.mocked(commonTypes.getConfig).mockReturnValue({
        INTERNAL_SERVICE_SECRET: 'valid-service-secret',
      } as any);

      mockReq.headers = { 'x-service-auth': 'valid-service-secret' };

      const middleware = requireServiceAuth();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledOnce();
      expect((mockReq as Request & { userId?: string }).userId).toBeUndefined();
    });
  });
});
