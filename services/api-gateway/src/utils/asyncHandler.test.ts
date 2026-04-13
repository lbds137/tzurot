import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

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

import { asyncHandler } from './asyncHandler.js';
import { ParameterError } from './requestParams.js';

function createMockRes(): Response & {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  headersSent: boolean;
} {
  const res = {
    headersSent: false,
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    headersSent: boolean;
  };
}

describe('asyncHandler', () => {
  const mockReq = {} as Request;

  beforeEach(() => vi.clearAllMocks());

  it('should call the handler and not send error on success', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const res = createMockRes();

    const wrapped = asyncHandler(handler);
    wrapped(mockReq, res);
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());

    expect(res.status).not.toHaveBeenCalled();
  });

  it('should send 400 for ParameterError', async () => {
    const handler = vi.fn().mockRejectedValue(new ParameterError('id'));
    const res = createMockRes();

    const wrapped = asyncHandler(handler);
    wrapped(mockReq, res);
    await vi.waitFor(() => expect(res.status).toHaveBeenCalled());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
  });

  it('should send 500 for generic errors', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Something broke'));
    const res = createMockRes();

    const wrapped = asyncHandler(handler);
    wrapped(mockReq, res);
    await vi.waitFor(() => expect(res.status).toHaveBeenCalled());

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('should not send error if headers already sent', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Late error'));
    const res = createMockRes();
    res.headersSent = true;

    const wrapped = asyncHandler(handler);
    wrapped(mockReq, res);
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());

    // Give the async handler time to process the error
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(res.status).not.toHaveBeenCalled();
  });
});
