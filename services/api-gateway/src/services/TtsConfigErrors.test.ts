/**
 * Tests for TtsConfigService typed errors. These are thin classes — the
 * tests exist to lock the message format the route layer relies on, since
 * the route translates these into specific user-facing error responses.
 */

import { describe, it, expect } from 'vitest';
import {
  TtsCloneNameExhaustedError,
  TtsAutoSuffixCollisionError,
  TtsInvalidProviderError,
} from './TtsConfigErrors.js';

describe('TtsCloneNameExhaustedError', () => {
  it('carries baseName and attempts in the message', () => {
    const err = new TtsCloneNameExhaustedError('Voice', 20);
    expect(err.message).toContain('Voice');
    expect(err.message).toContain('20');
    expect(err.name).toBe('TtsCloneNameExhaustedError');
    expect(err).toBeInstanceOf(Error);
  });

  it('exposes baseName and attempts as readable properties', () => {
    const err = new TtsCloneNameExhaustedError('Voice', 20);
    expect(err.baseName).toBe('Voice');
    expect(err.attempts).toBe(20);
  });
});

describe('TtsAutoSuffixCollisionError', () => {
  it('carries effectiveName in the message and chains the underlying cause', () => {
    const cause = new Error('Unique constraint failed');
    const err = new TtsAutoSuffixCollisionError('Voice (Copy 5)', cause);
    expect(err.message).toContain('Voice (Copy 5)');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('TtsAutoSuffixCollisionError');
  });

  it('exposes effectiveName as a readable property', () => {
    const err = new TtsAutoSuffixCollisionError('Voice (Copy 5)', new Error());
    expect(err.effectiveName).toBe('Voice (Copy 5)');
  });
});

describe('TtsInvalidProviderError', () => {
  it('names the bad provider value in the message', () => {
    const err = new TtsInvalidProviderError('mistal');
    expect(err.message).toContain('mistal');
    expect(err.message).toContain('self-hosted');
    expect(err.message).toContain('elevenlabs');
    expect(err.message).toContain('mistral');
    expect(err.name).toBe('TtsInvalidProviderError');
  });

  it('exposes provider as a readable property', () => {
    const err = new TtsInvalidProviderError('mistal');
    expect(err.provider).toBe('mistal');
  });
});
