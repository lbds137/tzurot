/**
 * Error Handler Middleware Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';

// Mock common-types
vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock errorResponses
vi.mock('../utils/errorResponses.js', () => ({
  ErrorResponses: {
    notFound: vi.fn((resource: string) => ({
      error: 'Not Found',
      message: `${resource} not found`,
    })),
    internalError: vi.fn((message: string) => ({ error: 'Internal Error', message })),
  },
}));

import { notFoundHandler, globalErrorHandler } from './errorHandler.js';
import { ErrorResponses } from '../utils/errorResponses.js';

describe('Error Handler Middleware', () => {
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonMock = vi.fn();
    statusMock = vi.fn(() => ({ json: jsonMock }));
    mockRes = {
      status: statusMock,
      json: jsonMock,
    } as Partial<Response>;
    mockNext = vi.fn();
  });

  describe('notFoundHandler', () => {
    it('should return 404 for unknown routes', () => {
      const mockReq = {
        method: 'GET',
        path: '/unknown',
      } as Request;

      notFoundHandler(mockReq, mockRes as Response);

      expect(ErrorResponses.notFound).toHaveBeenCalledWith('Route GET /unknown');
      expect(statusMock).toHaveBeenCalledWith(StatusCodes.NOT_FOUND);
      expect(jsonMock).toHaveBeenCalled();
    });

    it('should include method and path in error message', () => {
      const mockReq = {
        method: 'POST',
        path: '/api/test',
      } as Request;

      notFoundHandler(mockReq, mockRes as Response);

      expect(ErrorResponses.notFound).toHaveBeenCalledWith('Route POST /api/test');
    });
  });

  describe('globalErrorHandler', () => {
    it('should hide error details in production', () => {
      const handler = globalErrorHandler(true);
      const error = new Error('Sensitive database error');
      const mockReq = {} as Request;

      handler(error, mockReq, mockRes as Response, mockNext);

      expect(ErrorResponses.internalError).toHaveBeenCalledWith('Internal server error');
      expect(statusMock).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR);
    });

    it('should show error details in development', () => {
      const handler = globalErrorHandler(false);
      const error = new Error('Detailed debug error');
      const mockReq = {} as Request;

      handler(error, mockReq, mockRes as Response, mockNext);

      expect(ErrorResponses.internalError).toHaveBeenCalledWith('Detailed debug error');
      expect(statusMock).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR);
    });
  });
});
