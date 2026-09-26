import { describe, it, expect } from 'vitest';
import {
  AudioTooLongError,
  UnsupportedAudioFormatError,
  TimeoutError,
} from '@tzurot/common-types/utils/errors';
import { isDeterministicSttRejection } from './sttRejection.js';
import { RetryError } from '../../utils/retry.js';

describe('isDeterministicSttRejection', () => {
  it('is true for AudioTooLongError', () => {
    expect(isDeterministicSttRejection(new AudioTooLongError('too long'))).toBe(true);
  });

  it('is true for UnsupportedAudioFormatError', () => {
    expect(isDeterministicSttRejection(new UnsupportedAudioFormatError('bad format'))).toBe(true);
  });

  it('is false for TimeoutError', () => {
    expect(isDeterministicSttRejection(new TimeoutError(1000, 'transcribe'))).toBe(false);
  });

  it('is false for a plain Error', () => {
    expect(isDeterministicSttRejection(new Error('network blip'))).toBe(false);
  });

  it('is false for null', () => {
    expect(isDeterministicSttRejection(null)).toBe(false);
  });

  // withRetry's shouldRetry callback receives each attempt's raw thrown error
  // (retry.ts checkRetryableError is called with the caught `error` directly);
  // a RetryError only wraps the LAST attempt's error once every attempt is
  // exhausted, so no caller of this guard ever sees one. Documented here
  // rather than asserted as a mechanism claim: this is a false-case fixture,
  // not a behavior test of withRetry itself.
  it('is false for a RetryError wrapping AudioTooLongError (never seen by callers, but not falsely true)', () => {
    const wrapped = new RetryError('Voice transcription', 3, new AudioTooLongError('too long'));
    expect(isDeterministicSttRejection(wrapped)).toBe(false);
  });
});
