/**
 * Tests for buildErrorContent utility
 *
 * Unit tests for the shared error content building logic.
 * Uses real formatPersonalityErrorMessage and formatErrorSpoiler (not mocked)
 * to test the full formatting pipeline.
 */

import { describe, it, expect } from 'vitest';
import { buildErrorContent } from './buildErrorContent.js';
import type { LLMGenerationResult } from '@tzurot/common-types';

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

    it('should include technicalMessage in spoiler when provided', () => {
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

      expect(content).toBe(
        'Cannot think right now. ||*(error: quota exceeded — "402 Payment Required"; ref: ref-456)*||'
      );
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

    it('should use category-specific user message with technicalMessage', () => {
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
      expect(content).toContain('— "402 Insufficient credits"');
      expect(content).toContain('ref: ref-001');
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
