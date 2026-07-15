import { describe, it, expect } from 'vitest';
import { FEEDBACK_LIMITS } from '../../constants/feedback.js';
import { SubmitFeedbackInputSchema, SubmitFeedbackResponseSchema } from './feedback.js';

describe('SubmitFeedbackInputSchema', () => {
  it('trims and accepts ordinary content', () => {
    const parsed = SubmitFeedbackInputSchema.parse({ content: '  love the memory system  ' });
    expect(parsed.content).toBe('love the memory system');
  });

  it('rejects empty and whitespace-only content', () => {
    expect(SubmitFeedbackInputSchema.safeParse({ content: '' }).success).toBe(false);
    expect(SubmitFeedbackInputSchema.safeParse({ content: '   \n ' }).success).toBe(false);
  });

  it('rejects content over the limit (mirrors the DB column cap)', () => {
    expect(
      SubmitFeedbackInputSchema.safeParse({ content: 'x'.repeat(FEEDBACK_LIMITS.MAX_LENGTH + 1) })
        .success
    ).toBe(false);
    expect(
      SubmitFeedbackInputSchema.safeParse({ content: 'x'.repeat(FEEDBACK_LIMITS.MAX_LENGTH) })
        .success
    ).toBe(true);
  });
});

describe('SubmitFeedbackResponseSchema', () => {
  it('accepts the created shape and rejects success:false', () => {
    expect(
      SubmitFeedbackResponseSchema.safeParse({ success: true, feedbackId: 'fb-1' }).success
    ).toBe(true);
    expect(
      SubmitFeedbackResponseSchema.safeParse({ success: false, feedbackId: 'fb-1' }).success
    ).toBe(false);
  });
});
