import { describe, it, expect } from 'vitest';
import {
  FINISH_REASONS,
  isNaturalStop,
  resolveFinishReason,
  type FinishReason,
} from './finishReasons.js';

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

describe('resolveFinishReason', () => {
  it('should extract OpenAI/OpenRouter finish_reason', () => {
    expect(resolveFinishReason({ finish_reason: 'stop' })).toBe('stop');
  });

  it('should extract Anthropic stop_reason', () => {
    expect(resolveFinishReason({ stop_reason: 'end_turn' })).toBe('end_turn');
  });

  it('should extract Google finishReason (camelCase)', () => {
    expect(resolveFinishReason({ finishReason: 'STOP' })).toBe('STOP');
  });

  it('should prefer finish_reason over stop_reason', () => {
    expect(resolveFinishReason({ finish_reason: 'stop', stop_reason: 'end_turn' })).toBe('stop');
  });

  it('should return UNKNOWN for null metadata', () => {
    expect(resolveFinishReason(null)).toBe('unknown');
  });

  it('should return UNKNOWN for undefined metadata', () => {
    expect(resolveFinishReason(undefined)).toBe('unknown');
  });

  it('should return UNKNOWN for empty metadata', () => {
    expect(resolveFinishReason({})).toBe('unknown');
  });

  it('should return UNKNOWN for non-string finish reason', () => {
    expect(resolveFinishReason({ finish_reason: 42 })).toBe('unknown');
    expect(resolveFinishReason({ finish_reason: { nested: true } })).toBe('unknown');
  });
});
