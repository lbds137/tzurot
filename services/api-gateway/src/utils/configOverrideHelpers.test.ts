import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@tzurot/common-types';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

import { tryInvalidateCache, mergeAndValidateOverrides } from './configOverrideHelpers.js';

// Mock the merge function to control its return values
const mockMerge = vi.fn();
vi.mock('./configOverrideMerge.js', () => ({
  mergeConfigOverrides: (...args: unknown[]) => mockMerge(...args),
}));

const mockSendError = vi.fn();
vi.mock('./responseHelpers.js', () => ({
  sendError: (...args: unknown[]) => mockSendError(...args),
}));

vi.mock('./errorResponses.js', () => ({
  ErrorResponses: {
    validationError: (msg: string) => ({ error: 'VALIDATION', message: msg }),
  },
}));

describe('tryInvalidateCache', () => {
  beforeEach(() => vi.resetAllMocks());

  it('should call the invalidation function when provided', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await tryInvalidateCache(fn);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('should skip silently when fn is undefined', async () => {
    await tryInvalidateCache(undefined);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('should swallow errors and log warning with context', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Redis down'));
    await tryInvalidateCache(fn, { discordUserId: 'user-123' });
    expect(fn).toHaveBeenCalledOnce();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), discordUserId: 'user-123' }),
      'Failed to publish cache invalidation'
    );
  });
});

describe('mergeAndValidateOverrides', () => {
  const mockRes = {} as never;

  beforeEach(() => vi.resetAllMocks());

  it('should reject non-object body', () => {
    const result = mergeAndValidateOverrides(null, 'not-an-object', mockRes);
    expect(result.merged).toBeUndefined();
    expect(mockSendError).toHaveBeenCalledOnce();
  });

  it('should reject null body', () => {
    const result = mergeAndValidateOverrides(null, null, mockRes);
    expect(result.merged).toBeUndefined();
    expect(mockSendError).toHaveBeenCalledOnce();
  });

  it('should reject array body', () => {
    const result = mergeAndValidateOverrides(null, [1, 2, 3], mockRes);
    expect(result.merged).toBeUndefined();
    expect(mockSendError).toHaveBeenCalledOnce();
  });

  it('should return merged value on success', () => {
    const merged = { maxMessages: 50 };
    mockMerge.mockReturnValue(merged);

    const result = mergeAndValidateOverrides({ maxMessages: 25 }, { maxMessages: 50 }, mockRes);
    expect(result.merged).toEqual(merged);
    expect(result.prismaValue).toEqual(merged);
    expect(mockSendError).not.toHaveBeenCalled();
  });

  it('should return null merged with Prisma.JsonNull when merge clears all', () => {
    mockMerge.mockReturnValue(null);

    const result = mergeAndValidateOverrides({ maxMessages: 25 }, { maxMessages: null }, mockRes);
    expect(result.merged).toBeNull();
    expect(result.prismaValue).toBe(Prisma.JsonNull);
  });

  it('should send error on invalid merge result', () => {
    mockMerge.mockReturnValue('invalid');

    const result = mergeAndValidateOverrides({}, { bad: 'data' }, mockRes);
    expect(result.merged).toBeUndefined();
    expect(mockSendError).toHaveBeenCalledOnce();
  });
});
