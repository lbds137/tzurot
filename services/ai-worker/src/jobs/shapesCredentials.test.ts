import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyShapesError } from './shapesCredentials.js';
import {
  ShapesAuthError,
  ShapesFetchError,
  ShapesNotFoundError,
} from '../services/shapes/ShapesDataFetcher.js';

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
    decryptApiKey: vi.fn().mockReturnValue('decrypted-cookie'),
    encryptApiKey: vi.fn().mockReturnValue({ iv: 'iv', content: 'ct', tag: 'tg' }),
  };
});

describe('classifyShapesError', () => {
  beforeEach(() => vi.clearAllMocks());

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
    expect(result.errorMessage).toBe('Shape not found: test-slug');
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
