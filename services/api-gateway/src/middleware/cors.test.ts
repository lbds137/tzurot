/**
 * CORS Middleware Tests
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createCorsMiddleware } from './cors.js';

describe('CORS Middleware', () => {
  const mockNext: NextFunction = vi.fn();

  function createMockRequest(origin?: string, method = 'GET'): Partial<Request> {
    return {
      headers: origin ? { origin } : {},
      method,
    };
  }

  function createMockResponse(): Partial<Response> & { headers: Record<string, string> } {
    const headers: Record<string, string> = {};
    return {
      headers,
      header: vi.fn((key: string, value: string) => {
        headers[key] = value;
      }) as unknown as Response['header'],
      sendStatus: vi.fn(),
    };
  }

  it('should allow any origin when wildcard is configured', () => {
    const middleware = createCorsMiddleware({ origins: ['*'] });
    const req = createMockRequest('https://example.com');
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext);

    expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should allow specific origin when it matches', () => {
    const middleware = createCorsMiddleware({ origins: ['https://allowed.com'] });
    const req = createMockRequest('https://allowed.com');
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext);

    expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://allowed.com');
  });

  it('should not set origin header when origin is not allowed', () => {
    const middleware = createCorsMiddleware({ origins: ['https://allowed.com'] });
    const req = createMockRequest('https://notallowed.com');
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext);

    // header is called for methods and headers, but not for origin
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(mockNext).toHaveBeenCalled();
  });

  it('should not set origin header when no origin in request', () => {
    const middleware = createCorsMiddleware({ origins: ['*'] });
    const req = createMockRequest(undefined);
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext);

    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(mockNext).toHaveBeenCalled();
  });

  it('should respond to OPTIONS preflight requests', () => {
    const middleware = createCorsMiddleware({ origins: ['*'] });
    const req = createMockRequest('https://example.com', 'OPTIONS');
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext);

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should set standard CORS headers', () => {
    const middleware = createCorsMiddleware({ origins: ['*'] });
    const req = createMockRequest('https://example.com');
    const res = createMockResponse();

    middleware(req as Request, res as Response, mockNext);

    expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    expect(res.header).toHaveBeenCalledWith(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );
  });
});
