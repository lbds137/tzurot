import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyShapesError,
  getDecryptedCookie,
  persistUpdatedCookie,
} from './shapesCredentials.js';
import {
  ShapesAuthError,
  ShapesFetchError,
  ShapesNotFoundError,
} from '../services/shapes/shapesErrors.js';

const mockDecryptApiKey = vi.fn();
const mockEncryptApiKey = vi.fn();

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    decryptApiKey: (...args: unknown[]) => mockDecryptApiKey(...args),
    encryptApiKey: (...args: unknown[]) => mockEncryptApiKey(...args),
  };
});

const mockPrisma = {
  userCredential: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
};

describe('getDecryptedCookie', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns decrypted cookie when credential exists', async () => {
    mockPrisma.userCredential.findFirst.mockResolvedValue({
      iv: 'test-iv',
      content: 'test-content',
      tag: 'test-tag',
    });
    mockDecryptApiKey.mockReturnValue('session-cookie-value');

    const result = await getDecryptedCookie(mockPrisma as never, 'user-1');

    expect(result).toBe('session-cookie-value');
    expect(mockDecryptApiKey).toHaveBeenCalledWith({
      iv: 'test-iv',
      content: 'test-content',
      tag: 'test-tag',
    });
  });

  it('throws ShapesAuthError when no credential found', async () => {
    mockPrisma.userCredential.findFirst.mockResolvedValue(null);

    await expect(getDecryptedCookie(mockPrisma as never, 'user-1')).rejects.toThrow(
      ShapesAuthError
    );
  });
});

describe('persistUpdatedCookie', () => {
  beforeEach(() => vi.resetAllMocks());

  it('encrypts and persists the updated cookie', async () => {
    mockEncryptApiKey.mockReturnValue({ iv: 'new-iv', content: 'new-ct', tag: 'new-tg' });
    mockPrisma.userCredential.updateMany.mockResolvedValue({ count: 1 });

    await persistUpdatedCookie(mockPrisma as never, 'user-1', 'new-cookie');

    expect(mockEncryptApiKey).toHaveBeenCalledWith('new-cookie');
    expect(mockPrisma.userCredential.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          iv: 'new-iv',
          content: 'new-ct',
          tag: 'new-tg',
        }),
      })
    );
  });

  it('swallows encryption errors and resolves', async () => {
    mockEncryptApiKey.mockImplementation(() => {
      throw new Error('encryption failed');
    });

    await expect(
      persistUpdatedCookie(mockPrisma as never, 'user-1', 'bad')
    ).resolves.toBeUndefined();
  });

  it('swallows database errors and resolves', async () => {
    mockEncryptApiKey.mockReturnValue({ iv: 'iv', content: 'ct', tag: 'tg' });
    mockPrisma.userCredential.updateMany.mockRejectedValue(new Error('DB connection lost'));

    await expect(
      persistUpdatedCookie(mockPrisma as never, 'user-1', 'cookie')
    ).resolves.toBeUndefined();
  });
});

describe('classifyShapesError', () => {
  beforeEach(() => vi.resetAllMocks());

  it('should classify ShapesAuthError as non-retryable', () => {
    const error = new ShapesAuthError('Auth failed');
    const result = classifyShapesError(error);
    expect(result.isRetryable).toBe(false);
    expect(result.errorMessage).toBe('Auth failed');
  });

  it('should classify ShapesNotFoundError as non-retryable', () => {
    const error = new ShapesNotFoundError('test-slug');
    const result = classifyShapesError(error);
    expect(result.isRetryable).toBe(false);
    expect(result.errorMessage).toBe('Not found: test-slug');
  });

  it('should classify ShapesFetchError as non-retryable', () => {
    const error = new ShapesFetchError(403, 'Forbidden');
    const result = classifyShapesError(error);
    expect(result.isRetryable).toBe(false);
    expect(result.errorMessage).toBe('Forbidden');
  });

  it('should classify generic Error as retryable', () => {
    const error = new Error('Network timeout');
    const result = classifyShapesError(error);
    expect(result.isRetryable).toBe(true);
    expect(result.errorMessage).toBe('Network timeout');
  });

  it('should classify non-Error values as retryable', () => {
    const result = classifyShapesError('string error');
    expect(result.isRetryable).toBe(true);
    expect(result.errorMessage).toBe('string error');
  });
});
