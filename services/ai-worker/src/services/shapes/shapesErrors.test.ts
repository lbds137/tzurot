import { describe, it, expect } from 'vitest';
import {
  ShapesAuthError,
  ShapesNotFoundError,
  ShapesRateLimitError,
  ShapesServerError,
  ShapesFetchError,
} from './shapesErrors.js';

describe('ShapesAuthError', () => {
  it('should set name and message', () => {
    const error = new ShapesAuthError('Session expired');
    expect(error.name).toBe('ShapesAuthError');
    expect(error.message).toBe('Session expired');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('ShapesNotFoundError', () => {
  it('should set name and format message with slug', () => {
    const error = new ShapesNotFoundError('test-slug');
    expect(error.name).toBe('ShapesNotFoundError');
    expect(error.message).toBe('Shape not found: test-slug');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('ShapesRateLimitError', () => {
  it('should set name and default message', () => {
    const error = new ShapesRateLimitError();
    expect(error.name).toBe('ShapesRateLimitError');
    expect(error.message).toBe('Rate limited by shapes.inc');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('ShapesServerError', () => {
  it('should set name, message, and status', () => {
    const error = new ShapesServerError(502, 'Bad Gateway');
    expect(error.name).toBe('ShapesServerError');
    expect(error.message).toBe('Bad Gateway');
    expect(error.status).toBe(502);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('ShapesFetchError', () => {
  it('should set name, message, and status', () => {
    const error = new ShapesFetchError(422, 'Unprocessable');
    expect(error.name).toBe('ShapesFetchError');
    expect(error.message).toBe('Unprocessable');
    expect(error.status).toBe(422);
    expect(error).toBeInstanceOf(Error);
  });
});
