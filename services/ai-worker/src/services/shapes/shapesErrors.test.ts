import { describe, it, expect } from 'vitest';
import {
  ShapesAuthError,
  ShapesBotProtectionError,
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
  it('should set name and format message with resource identifier', () => {
    const error = new ShapesNotFoundError('test-slug');
    expect(error.name).toBe('ShapesNotFoundError');
    expect(error.message).toBe('Not found: test-slug');
    expect(error).toBeInstanceOf(Error);
  });

  it('should work with full URL as resource', () => {
    const url = 'https://talk.shapes.inc/api/shapes/username/test-shape';
    const error = new ShapesNotFoundError(url);
    expect(error.message).toBe(`Not found: ${url}`);
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

describe('ShapesBotProtectionError', () => {
  it('should set name and weave the detected signal into the guidance message', () => {
    const error = new ShapesBotProtectionError("'x-datadome: protected' response header");
    expect(error.name).toBe('ShapesBotProtectionError');
    expect(error.message).toContain("'x-datadome: protected' response header");
    expect(error.message).toContain('bot-detection middleware');
    expect(error.message).toContain('Retrying will not help');
    expect(error).toBeInstanceOf(Error);
  });
});
