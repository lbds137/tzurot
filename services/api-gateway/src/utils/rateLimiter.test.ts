/**
 * Tests for rate limiter middleware
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

import { createRateLimiter, createWalletRateLimiter } from './rateLimiter.js';

describe('rateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to create mock request/response/next
  function createMockReqResNext(userId = 'user-123') {
    const req = {
      headers: { 'x-user-id': userId },
    } as unknown as Request;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    const next = vi.fn() as NextFunction;

    return { req, res, next };
  }

  describe('createRateLimiter', () => {
    it('should allow requests within limit', () => {
      const limiter = createRateLimiter({ maxRequests: 5, windowMs: 60000 });
      const { req, res, next } = createMockReqResNext();

      // Make 5 requests (should all pass)
      for (let i = 0; i < 5; i++) {
        limiter(req, res, next);
      }

      expect(next).toHaveBeenCalledTimes(5);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should block requests over limit', () => {
      const limiter = createRateLimiter({ maxRequests: 3, windowMs: 60000 });
      const { req, res, next } = createMockReqResNext();

      // Make 3 requests (should pass)
      for (let i = 0; i < 3; i++) {
        limiter(req, res, next);
      }

      // 4th request should be blocked
      limiter(req, res, next);

      expect(next).toHaveBeenCalledTimes(3);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'RATE_LIMIT_EXCEEDED',
        })
      );
    });

    it('should reset after window expires', () => {
      const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60000 });
      const { req, res, next } = createMockReqResNext();

      // Make 2 requests (should pass)
      limiter(req, res, next);
      limiter(req, res, next);

      // 3rd request should be blocked
      limiter(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);

      // Advance time past window
      vi.advanceTimersByTime(60001);

      // Reset mocks and try again
      vi.clearAllMocks();
      limiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should track different users separately', () => {
      const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60000 });

      const user1 = createMockReqResNext('user-1');
      const user2 = createMockReqResNext('user-2');

      // User 1 makes 2 requests
      limiter(user1.req, user1.res, user1.next);
      limiter(user1.req, user1.res, user1.next);

      // User 2 should still be able to make requests
      limiter(user2.req, user2.res, user2.next);
      limiter(user2.req, user2.res, user2.next);

      expect(user1.next).toHaveBeenCalledTimes(2);
      expect(user2.next).toHaveBeenCalledTimes(2);
    });

    it('should allow requests without user id', () => {
      const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60000 });
      const { req, res, next } = createMockReqResNext('');

      // Requests without user id should pass through
      limiter(req, res, next);
      limiter(req, res, next);
      limiter(req, res, next);

      expect(next).toHaveBeenCalledTimes(3);
    });

    it('should use custom message', () => {
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
        message: 'Custom rate limit message',
      });
      const { req, res, next } = createMockReqResNext();

      limiter(req, res, next);
      limiter(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Custom rate limit message',
        })
      );
    });

    it('should use custom key generator', () => {
      const limiter = createRateLimiter({
        maxRequests: 2,
        windowMs: 60000,
        keyGenerator: (req: Request) => (req.headers['x-custom-key'] as string) ?? '',
      });

      const req = {
        headers: { 'x-custom-key': 'custom-user', 'x-user-id': 'ignored' },
      } as unknown as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
      const next = vi.fn() as NextFunction;

      limiter(req, res, next);
      limiter(req, res, next);
      limiter(req, res, next);

      expect(next).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('should include retryAfter in response', () => {
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60000 });
      const { req, res, next } = createMockReqResNext();

      limiter(req, res, next);

      // Advance 10 seconds
      vi.advanceTimersByTime(10000);

      // Blocked request
      limiter(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          retryAfter: expect.any(Number),
        })
      );

      // retryAfter should be ~50 seconds
      const call = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.retryAfter).toBeGreaterThan(45);
      expect(call.retryAfter).toBeLessThanOrEqual(50);
    });
  });

  describe('createWalletRateLimiter', () => {
    it('should create a rate limiter with wallet-specific settings', () => {
      const limiter = createWalletRateLimiter();
      const { req, res, next } = createMockReqResNext();

      // Should allow 10 requests
      for (let i = 0; i < 10; i++) {
        limiter(req, res, next);
      }

      expect(next).toHaveBeenCalledTimes(10);

      // 11th should be blocked
      limiter(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Too many API key operations. Please try again later.',
        })
      );
    });
  });
});
