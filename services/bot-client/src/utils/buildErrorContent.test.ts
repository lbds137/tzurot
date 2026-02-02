/**
 * Tests for buildErrorContent utility
 *
 * Unit tests for the shared error content building logic.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildErrorContent } from './buildErrorContent.js';
import type { LLMGenerationResult } from '@tzurot/common-types';

// Mock common-types
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    formatPersonalityErrorMessage: vi.fn(
      (message: string, category: string, referenceId?: string) => {
        const refPart = referenceId !== undefined ? `; ref: ${referenceId}` : '';
        // Simulate the placeholder replacement behavior
        if (message.includes('||*(an error has occurred)*||')) {
          return message.replace('||*(an error has occurred)*||', `||*(${category}${refPart})*||`);
        }
        // Append if no placeholder
        return `${message} ||*(${category}${refPart})*||`;
      }
    ),
    USER_ERROR_MESSAGES: {
      rate_limit: 'Slow down! Too many requests.',
      quota_exceeded: 'Your API quota has been exceeded.',
      model_unavailable: 'The selected model is currently unavailable.',
      invalid_config: 'There is an issue with your configuration.',
    } as const,
  };
});

describe('buildErrorContent', () => {
  describe('with errorInfo and personalityErrorMessage', () => {
    it('should format personality message with error details', () => {
      const result = {
        success: false,
        errorInfo: {
          category: 'rate_limit' as const,
          referenceId: 'ref-123',
        },
        personalityErrorMessage: 'Oops! Something went wrong ||*(an error has occurred)*||',
      } as unknown as LLMGenerationResult;

      const content = buildErrorContent(result);

      expect(content).toBe('Oops! Something went wrong ||*(rate_limit; ref: ref-123)*||');
    });

    it('should append error details when no placeholder in personality message', () => {
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
        "I'm having trouble thinking right now... ||*(quota_exceeded; ref: ref-456)*||"
      );
    });

    it('should handle missing referenceId', () => {
      const result = {
        success: false,
        errorInfo: {
          category: 'model_unavailable' as const,
        },
        personalityErrorMessage: 'Cannot think right now.',
      } as unknown as LLMGenerationResult;

      const content = buildErrorContent(result);

      expect(content).toBe('Cannot think right now. ||*(model_unavailable)*||');
    });
  });

  describe('with errorInfo but no personalityErrorMessage', () => {
    it('should use category-specific user message with reference', () => {
      const result = {
        success: false,
        errorInfo: {
          category: 'rate_limit' as const,
          referenceId: 'ref-789',
        },
        personalityErrorMessage: undefined,
      } as unknown as LLMGenerationResult;

      const content = buildErrorContent(result);

      expect(content).toBe('Slow down! Too many requests. ||*(reference: ref-789)*||');
    });

    it('should use category-specific user message without reference', () => {
      const result = {
        success: false,
        errorInfo: {
          category: 'quota_exceeded' as const,
        },
        personalityErrorMessage: '',
      } as unknown as LLMGenerationResult;

      const content = buildErrorContent(result);

      expect(content).toBe('Your API quota has been exceeded.');
    });

    it('should use default error for unknown category', () => {
      const result = {
        success: false,
        errorInfo: {
          category: 'unknown_category' as const,
        },
      } as unknown as LLMGenerationResult;

      const content = buildErrorContent(result);

      expect(content).toBe(
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
