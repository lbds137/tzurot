import { describe, it, expect, vi } from 'vitest';

import {
  reasoningConstraintViolation,
  warnOnReasoningConstraintViolation,
} from './reasoningConstraintCheck.js';

// reasoning.max_tokens is schema-bounded to [1024, 32000], so fixtures use
// values in that range — a sub-1024 reasoning budget is rejected at parse
// (safeValidateAdvancedParams → null) before the constraint is even checked.
describe('reasoningConstraintViolation', () => {
  it('flags reasoning.max_tokens >= max_tokens (no room for the response)', () => {
    expect(
      reasoningConstraintViolation({ max_tokens: 1024, reasoning: { max_tokens: 2000 } })
    ).toEqual({ reasoningMaxTokens: 2000, maxTokens: 1024 });
    // equal is still a violation (0 tokens left for the response)
    expect(
      reasoningConstraintViolation({ max_tokens: 2000, reasoning: { max_tokens: 2000 } })
    ).toEqual({ reasoningMaxTokens: 2000, maxTokens: 2000 });
  });

  it('returns null when reasoning fits within max_tokens', () => {
    expect(
      reasoningConstraintViolation({ max_tokens: 5000, reasoning: { max_tokens: 2000 } })
    ).toBeNull();
  });

  it('returns null when reasoning is not enabled', () => {
    expect(
      reasoningConstraintViolation({
        max_tokens: 1024,
        reasoning: { enabled: false, max_tokens: 2000 },
      })
    ).toBeNull();
    expect(reasoningConstraintViolation({ max_tokens: 1024 })).toBeNull();
  });

  it('returns null when either budget is absent (nothing to compare)', () => {
    // no top-level max_tokens
    expect(reasoningConstraintViolation({ reasoning: { max_tokens: 2000 } })).toBeNull();
    // reasoning enabled by effort only, no reasoning.max_tokens
    expect(
      reasoningConstraintViolation({ max_tokens: 1024, reasoning: { effort: 'high' } })
    ).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(reasoningConstraintViolation('garbage')).toBeNull();
    expect(reasoningConstraintViolation(undefined)).toBeNull();
    expect(reasoningConstraintViolation({ max_tokens: 'not-a-number' })).toBeNull();
  });
});

describe('warnOnReasoningConstraintViolation', () => {
  it('warns (never throws) with the config context on a violation', () => {
    const logger = { warn: vi.fn() };
    warnOnReasoningConstraintViolation(
      logger,
      { configId: 'c1' },
      { max_tokens: 1024, reasoning: { max_tokens: 2000 } }
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { configId: 'c1', reasoningMaxTokens: 2000, maxTokens: 1024 },
      expect.stringContaining('reasoning.max_tokens >= max_tokens')
    );
  });

  it('stays silent when there is no violation', () => {
    const logger = { warn: vi.fn() };
    warnOnReasoningConstraintViolation(
      logger,
      { configId: 'c1' },
      { max_tokens: 5000, reasoning: { max_tokens: 2000 } }
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
