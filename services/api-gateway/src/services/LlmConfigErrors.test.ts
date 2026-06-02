/**
 * Tests for LlmConfigService typed errors. These are thin classes — the
 * tests exist to lock the message format the route layer relies on, since
 * the route translates these into specific user-facing error responses.
 */

import { describe, it, expect } from 'vitest';
import { CloneNameExhaustedError, AutoSuffixCollisionError } from './LlmConfigErrors.js';

describe('CloneNameExhaustedError', () => {
  it('carries baseName and attempts in the message', () => {
    const err = new CloneNameExhaustedError('Preset', 20);
    expect(err.message).toContain('Preset');
    expect(err.message).toContain('20');
    expect(err.name).toBe('CloneNameExhaustedError');
    expect(err).toBeInstanceOf(Error);
  });

  it('exposes baseName and attempts as readable properties', () => {
    const err = new CloneNameExhaustedError('Preset', 20);
    expect(err.baseName).toBe('Preset');
    expect(err.attempts).toBe(20);
  });
});

describe('AutoSuffixCollisionError', () => {
  it('carries effectiveName in the message and chains the underlying cause', () => {
    const cause = new Error('Unique constraint failed');
    const err = new AutoSuffixCollisionError('Preset (Copy 5)', cause);
    expect(err.message).toContain('Preset (Copy 5)');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('AutoSuffixCollisionError');
  });

  it('exposes effectiveName as a readable property', () => {
    const err = new AutoSuffixCollisionError('Preset (Copy 5)', new Error());
    expect(err.effectiveName).toBe('Preset (Copy 5)');
  });
});
