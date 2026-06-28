import { describe, it, expect } from 'vitest';
import { NotFoundError } from './appErrors.js';

describe('NotFoundError', () => {
  it('is an Error subclass exposing `resource` with a default `<resource> not found` message', () => {
    const err = new NotFoundError('LLM config');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.name).toBe('NotFoundError');
    expect(err.resource).toBe('LLM config');
    expect(err.message).toBe('LLM config not found');
  });

  it('uses logMessage for the (server-side) message while keeping resource body-safe', () => {
    const err = new NotFoundError('LLM config', 'setAsDefault: config abc not found');
    expect(err.resource).toBe('LLM config');
    expect(err.message).toBe('setAsDefault: config abc not found');
  });
});
