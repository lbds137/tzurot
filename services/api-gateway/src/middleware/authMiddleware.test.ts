/**
 * Authentication Middleware Tests
 *
 * Comprehensive test coverage for owner authentication middleware.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { extractOwnerId, isValidOwner, requireOwnerAuth } from './authMiddleware.js';
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
});
