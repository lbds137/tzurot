/**
 * Tests for buildErrorContent utility
 *
 * Unit tests for the shared error content building logic.
 * Uses real formatPersonalityErrorMessage and formatErrorSpoiler (not mocked)
 * to test the full formatting pipeline.
 */

import { describe, it, expect } from 'vitest';
import { buildErrorContent } from './buildErrorContent.js';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import {
  ApiErrorCategory,
  ApiErrorType,
  formatErrorSpoiler,
  USER_ERROR_MESSAGES,
} from '@tzurot/common-types/constants/error';
import { undecryptableApiKeyMessage } from '@tzurot/common-types/utils/providerDisplayName';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';

describe('buildErrorContent', () => {
  describe('with errorInfo and personalityErrorMessage', () => {
    it('should format personality message with error details', () => {
      const result = {
        success: false,
        errorInfo: {
          category: 'rate_limit' as const,
          referenceId: 'ref-123',
        },
        personalityErrorMessage: 'Oops! Something went wrong.',
      } as unknown as LLMGenerationResult;

      const content = buildErrorContent(result);

      expect(content).toBe('Oops! Something went wrong. ||*(error: rate limit; ref: ref-123)*||');
    });

    it('should append error details to personality message', () => {
      const result = {
        success: false,
        errorInfo: {
          category: 'quota_exceeded' as const,
          referenceId: 'ref-456',
        },
        personalityErrorMessage: "I'm having trouble thinking right now...",
      } as unknown as LLMGenerationResult;

      const content = buildErrorContent(result);

      expect(content).toBe(
        "I'm having trouble thinking right now... ||*(error: quota exceeded; ref: ref-456)*||"
      );
    });

    it('should omit technicalMessage from spoiler when provided on errorInfo', () => {
      const result = {
        success: false,
        errorInfo: {
          category: 'quota_exceeded' as const,
          referenceId: 'ref-456',
          technicalMessage: '402 Payment Required',
        },
        personalityErrorMessage: 'Cannot think right now.',
      } as unknown as LLMGenerationResult;

      const content = buildErrorContent(result);

      expect(content).toBe('Cannot think right now. ||*(error: quota exceeded; ref: ref-456)*||');
    });
  });

  describe('with errorInfo but no personalityErrorMessage', () => {
    it('should use category-specific user message with spoiler', () => {
      const result = {
        success: false,
        errorInfo: {
          category: 'rate_limit' as const,
          referenceId: 'ref-789',
        },
        personalityErrorMessage: undefined,
      } as unknown as LLMGenerationResult;

      const content = buildErrorContent(result);

      expect(content).toContain("I'm receiving too many requests right now");
      expect(content).toContain('||*(error: rate limit; ref: ref-789)*||');
    });

    it('should omit technicalMessage from spoiler on category-specific user message', () => {
      const result = {
        success: false,
        errorInfo: {
          category: 'quota_exceeded' as const,
          referenceId: 'ref-001',
          technicalMessage: '402 Insufficient credits',
        },
        personalityErrorMessage: '',
      } as unknown as LLMGenerationResult;

      const content = buildErrorContent(result);

      expect(content).toContain("You've reached your API usage limit");
      expect(content).toContain('||*(error: quota exceeded; ref: ref-001)*||');
      expect(content).not.toContain('402 Insufficient credits');
    });

    it('should use default error for unknown category', () => {
      const result = {
        success: false,
        errorInfo: {
          category: 'unknown_category' as const,
          referenceId: 'ref-unk',
        },
      } as unknown as LLMGenerationResult;

      const content = buildErrorContent(result);

      expect(content).toContain(
        'Sorry, I encountered an error generating a response. Please try again later.'
      );
    });
  });

  describe('userActionMessage (undecryptable BYOK key, rendered plainly)', () => {
    const copy = undecryptableApiKeyMessage(AIProvider.OpenRouter);
    const generic = USER_ERROR_MESSAGES[ApiErrorCategory.AUTHENTICATION];
    const spoiler = formatErrorSpoiler(ApiErrorCategory.AUTHENTICATION, 'ref-key');
    const baseResult = {
      success: false,
      errorInfo: {
        type: ApiErrorType.PERMANENT,
        category: ApiErrorCategory.AUTHENTICATION,
        userMessage: generic,
        userActionMessage: copy,
        referenceId: 'ref-key',
        shouldRetry: false,
      },
    } as unknown as LLMGenerationResult;

    /** Everything outside `||...||` spoiler spans. */
    const outsideSpoilers = (content: string): string => content.replace(/\|\|.*?\|\|/gs, '');

    it('default branch: copy replaces the generic line and sits outside the spoiler', () => {
      const content = buildErrorContent(baseResult);

      expect(outsideSpoilers(content)).toContain(copy);
      expect(content).not.toContain(generic);
      expect(content).toBe(`${copy} ${spoiler}`);
    });

    it('personality branch: personality voice, then the copy on its own line, outside the spoiler', () => {
      const content = buildErrorContent({
        ...baseResult,
        personalityErrorMessage: 'Oops, my circuits fizzled.',
      } as LLMGenerationResult);

      expect(outsideSpoilers(content)).toContain(copy);
      expect(content).toBe(`Oops, my circuits fizzled. ${spoiler}\n${copy}`);
    });

    it('missing-referenceId guard branch: returns the copy plainly', () => {
      const content = buildErrorContent({
        ...baseResult,
        errorInfo: { ...baseResult.errorInfo, referenceId: '' },
      } as LLMGenerationResult);

      expect(content).toBe(copy);
    });

    it('ignores an empty userActionMessage (falls back to the category line)', () => {
      const content = buildErrorContent({
        ...baseResult,
        errorInfo: { ...baseResult.errorInfo, userActionMessage: '' },
      } as LLMGenerationResult);

      expect(content).toContain(generic);
    });
  });

  describe('without errorInfo', () => {
    it('should fall back to personalityErrorMessage when available', () => {
      const result = {
        success: false,
        personalityErrorMessage: 'Custom personality error message.',
      } as unknown as LLMGenerationResult;

      const content = buildErrorContent(result);

      expect(content).toBe('Custom personality error message.');
    });

    it('should use default error when no personalityErrorMessage', () => {
      const result = {
        success: false,
      } as unknown as LLMGenerationResult;

      const content = buildErrorContent(result);

      expect(content).toBe(
        'Sorry, I encountered an error generating a response. Please try again later.'
      );
    });

    it('should use default error when personalityErrorMessage is undefined', () => {
      const result = {
        success: false,
        personalityErrorMessage: undefined,
      } as unknown as LLMGenerationResult;

      const content = buildErrorContent(result);

      expect(content).toBe(
        'Sorry, I encountered an error generating a response. Please try again later.'
      );
    });
  });
});
