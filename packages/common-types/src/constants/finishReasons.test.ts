import { describe, it, expect } from 'vitest';
import { FINISH_REASONS, isNaturalStop, type FinishReason } from './finishReasons.js';

describe('FINISH_REASONS', () => {
  it('should have expected values', () => {
    expect(FINISH_REASONS.STOP).toBe('stop');
    expect(FINISH_REASONS.END_TURN).toBe('end_turn');
    expect(FINISH_REASONS.STOP_GOOGLE).toBe('STOP');
    expect(FINISH_REASONS.LENGTH).toBe('length');
    expect(FINISH_REASONS.STOP_SEQUENCE).toBe('stop_sequence');
    expect(FINISH_REASONS.CONTENT_FILTER).toBe('content_filter');
    expect(FINISH_REASONS.UNKNOWN).toBe('unknown');
  });

  it('should have 7 known finish reasons', () => {
    expect(Object.keys(FINISH_REASONS)).toHaveLength(7);
  });

  it('should be assignable to FinishReason type', () => {
    const reason: FinishReason = FINISH_REASONS.STOP;
    expect(reason).toBe('stop');
  });
});

describe('isNaturalStop', () => {
  it('should return true for OpenAI/OpenRouter stop', () => {
    expect(isNaturalStop('stop')).toBe(true);
  });

  it('should return true for Anthropic end_turn', () => {
    expect(isNaturalStop('end_turn')).toBe(true);
  });

  it('should return true for Google STOP (uppercase)', () => {
    expect(isNaturalStop('STOP')).toBe(true);
  });

  it('should return false for length (token limit)', () => {
    expect(isNaturalStop('length')).toBe(false);
  });

  it('should return false for stop_sequence', () => {
    expect(isNaturalStop('stop_sequence')).toBe(false);
  });

  it('should return false for content_filter', () => {
    expect(isNaturalStop('content_filter')).toBe(false);
  });

  it('should return false for unknown', () => {
    expect(isNaturalStop('unknown')).toBe(false);
  });

  it('should return false for arbitrary values', () => {
    expect(isNaturalStop('some_random_value')).toBe(false);
    expect(isNaturalStop('')).toBe(false);
  });
});
