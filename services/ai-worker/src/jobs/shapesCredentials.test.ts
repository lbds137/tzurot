import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GENERIC_SHAPES_JOB_ERROR_MESSAGE,
  classifyShapesError,
  getDecryptedCookie,
  persistUpdatedCookie,
} from './shapesCredentials.js';
import {
  ShapesAuthError,
  ShapesBotProtectionError,
  ShapesFetchBusyError,
  ShapesFetchError,
  ShapesJobValidationError,
  ShapesNotFoundError,
  ShapesRateLimitError,
  ShapesServerError,
} from '../services/shapes/shapesErrors.js';

const mockDecryptApiKey = vi.fn();
const mockEncryptApiKey = vi.fn();

vi.mock('@tzurot/common-types/utils/encryption', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/encryption')>(
    '@tzurot/common-types/utils/encryption'
  );
  return {
    ...actual,
    decryptApiKey: (...args: unknown[]) => mockDecryptApiKey(...args),
    encryptApiKey: (...args: unknown[]) => mockEncryptApiKey(...args),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
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

  it('throws ShapesAuthError when the stored credential cannot be decrypted', async () => {
    const realEncryption = await vi.importActual<
      typeof import('@tzurot/common-types/utils/encryption')
    >('@tzurot/common-types/utils/encryption');

    const previousKey = process.env.API_KEY_ENCRYPTION_KEY;
    const previousPreviousKey = process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
    process.env.API_KEY_ENCRYPTION_KEY = 'a'.repeat(64);
    delete process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;

    try {
      const encrypted = realEncryption.encryptApiKey(
        '__Secure-better-auth.session_token=TEST-FIXTURE-not-a-real-session-token-abcdef'
      );

      const corruptedTag = `${encrypted.tag[0] === '0' ? '1' : '0'}${encrypted.tag.slice(1)}`;
      const corruptedCredential = { ...encrypted, tag: corruptedTag };

      // Pins that the fixture itself fails via the GCM auth-tag mismatch
      // (not a missing-key config error) BEFORE it reaches
      // getDecryptedCookie's own catch, which would otherwise mask either
      // underlying failure behind the same ShapesAuthError message.
      expect(() => realEncryption.decryptApiKey(corruptedCredential)).toThrow(
        'Unsupported state or unable to authenticate data'
      );

      mockPrisma.userCredential.findFirst.mockResolvedValue(corruptedCredential);
      mockDecryptApiKey.mockImplementation(realEncryption.decryptApiKey);

      const error = await getDecryptedCookie(mockPrisma as never, 'user-1').catch(
        (e: unknown) => e
      );
      expect(error).toBeInstanceOf(ShapesAuthError);
      expect((error as Error).message).toContain('/shapes auth');
    } finally {
      if (previousKey === undefined) {
        delete process.env.API_KEY_ENCRYPTION_KEY;
      } else {
        process.env.API_KEY_ENCRYPTION_KEY = previousKey;
      }
      if (previousPreviousKey === undefined) {
        delete process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
      } else {
        process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS = previousPreviousKey;
      }
    }
  });

  it('lets a credential-lookup failure propagate instead of reporting an auth error', async () => {
    mockPrisma.userCredential.findFirst.mockRejectedValue(new Error('db boom'));

    const error = await getDecryptedCookie(mockPrisma as never, 'user-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('db boom');
    expect(error instanceof ShapesAuthError).toBe(false);
  });

  it('lets a decrypt failure propagate as its original error instead of reporting an auth error when the service is misconfigured', async () => {
    const realEncryption = await vi.importActual<
      typeof import('@tzurot/common-types/utils/encryption')
    >('@tzurot/common-types/utils/encryption');

    const previousKey = process.env.API_KEY_ENCRYPTION_KEY;
    const previousPreviousKey = process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
    delete process.env.API_KEY_ENCRYPTION_KEY;
    delete process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;

    try {
      mockPrisma.userCredential.findFirst.mockResolvedValue({
        iv: 'iv',
        content: 'content',
        tag: 'tag',
      });
      mockDecryptApiKey.mockImplementation(realEncryption.decryptApiKey);

      const error = await getDecryptedCookie(mockPrisma as never, 'user-1').catch(
        (e: unknown) => e
      );

      expect(error instanceof ShapesAuthError).toBe(false);
      expect((error as Error).message).toContain(
        'API_KEY_ENCRYPTION_KEY environment variable is required'
      );
    } finally {
      if (previousKey === undefined) {
        delete process.env.API_KEY_ENCRYPTION_KEY;
      } else {
        process.env.API_KEY_ENCRYPTION_KEY = previousKey;
      }
      if (previousPreviousKey === undefined) {
        delete process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
      } else {
        process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS = previousPreviousKey;
      }
    }
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

  it('should classify ShapesBotProtectionError as non-retryable (a bot wall does not clear on retry)', () => {
    const error = new ShapesBotProtectionError("'x-datadome: protected' response header");
    const result = classifyShapesError(error);
    expect(result.isRetryable).toBe(false);
    expect(result.errorMessage).toContain('bot-detection middleware');
  });

  it('should classify ShapesFetchBusyError as RETRYABLE (BullMQ backoff waits out the gate)', () => {
    const error = new ShapesFetchBusyError(2);
    const result = classifyShapesError(error);
    expect(result.isRetryable).toBe(true);
    expect(result.errorMessage).toContain('Too many simultaneous shapes.inc fetches');
  });

  it('should classify ShapesJobValidationError as non-retryable, keeping its authored message', () => {
    // A failed precondition re-reads the same rows on every attempt —
    // retrying burns BullMQ attempts for nothing; the copy tells the user
    // what to fix.
    const error = new ShapesJobValidationError('Cannot import: user not found.');
    const result = classifyShapesError(error);
    expect(result.isRetryable).toBe(false);
    expect(result.errorMessage).toBe('Cannot import: user not found.');
  });

  it('should classify ShapesRateLimitError as retryable, keeping its authored message', () => {
    const result = classifyShapesError(new ShapesRateLimitError());
    expect(result.isRetryable).toBe(true);
    expect(result.errorMessage).toBe('Rate limited by shapes.inc');
  });

  it('should classify ShapesServerError as retryable, keeping its authored message', () => {
    const result = classifyShapesError(
      new ShapesServerError(502, 'Shapes.inc server error: HTTP 502')
    );
    expect(result.isRetryable).toBe(true);
    expect(result.errorMessage).toBe('Shapes.inc server error: HTTP 502');
  });

  it('replaces a generic Error message with the user-safe copy (raw infra detail never stored)', () => {
    // The status routes return errorMessage verbatim — a raw driver/network
    // string (which can carry hostnames and connection detail) must not
    // reach the user-visible column. Full error still goes to logs.
    const error = new Error('connect ETIMEDOUT db.internal.railway:5432');
    const result = classifyShapesError(error);
    expect(result.isRetryable).toBe(true);
    expect(result.errorMessage).toBe(GENERIC_SHAPES_JOB_ERROR_MESSAGE);
    expect(result.errorMessage).not.toContain('railway');
  });

  it('replaces non-Error values with the user-safe copy', () => {
    const result = classifyShapesError('string error');
    expect(result.isRetryable).toBe(true);
    expect(result.errorMessage).toBe(GENERIC_SHAPES_JOB_ERROR_MESSAGE);
  });
});
