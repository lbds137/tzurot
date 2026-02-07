/**
 * Build Error Content Utility
 *
 * Shared utility for building user-facing error messages from LLMGenerationResult.
 * Used by both MessageHandler (async job results) and chat.ts (slash command polling).
 */

import {
  formatPersonalityErrorMessage,
  formatErrorSpoiler,
  USER_ERROR_MESSAGES,
  type LLMGenerationResult,
} from '@tzurot/common-types';

const DEFAULT_ERROR =
  'Sorry, I encountered an error generating a response. Please try again later.';

/**
 * Build error content for user display
 *
 * If the result has structured error info and a personality error message,
 * formats the message to include error details in Discord spoiler tags.
 * This allows users to see what went wrong while keeping the error message
 * in the personality's voice.
 *
 * Example with placeholder:
 *   Input: "Oops! Something went wrong ||*(an error has occurred)*||"
 *   Output: "Oops! Something went wrong ||*(error: quota exceeded — "402 Payment Required"; ref: m5abc123)*||"
 *
 * Example without placeholder:
 *   Input: "I'm having trouble thinking right now..."
 *   Output: "I'm having trouble thinking right now... ||*(error: quota exceeded; ref: m5abc123)*||"
 */
export function buildErrorContent(result: LLMGenerationResult): string {
  // If we have structured error info, use it for dynamic messaging
  if (result.errorInfo) {
    const { category, referenceId, technicalMessage } = result.errorInfo;

    // Guard: referenceId is required by Zod schema, but be defensive for edge cases
    if (referenceId === undefined || referenceId.length === 0) {
      const userMessage = USER_ERROR_MESSAGES[category] ?? DEFAULT_ERROR;
      return result.personalityErrorMessage ?? userMessage;
    }

    // If personality has a custom error message, format it with error details
    if (result.personalityErrorMessage !== undefined && result.personalityErrorMessage !== '') {
      return formatPersonalityErrorMessage(
        result.personalityErrorMessage,
        category,
        referenceId,
        technicalMessage
      );
    }

    // No personality message - use the category-specific user message with spoiler
    const userMessage = USER_ERROR_MESSAGES[category] ?? DEFAULT_ERROR;
    const spoiler = formatErrorSpoiler(category, referenceId, technicalMessage);
    return `${userMessage} ${spoiler}`;
  }

  // No error info available - fall back to basic error message
  return result.personalityErrorMessage ?? DEFAULT_ERROR;
}
