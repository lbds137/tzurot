/**
 * Utility Function Mocks
 *
 * Simple function mocks for utilities that don't have complex class structures.
 */

import { type Mock, vi } from 'vitest';

/**
 * Mock for MultimodalProcessor.processAttachments
 */
export const mockProcessAttachments: Mock = vi.fn().mockResolvedValue([]);

export const mockMultimodalProcessor: { processAttachments: Mock } = {
  processAttachments: mockProcessAttachments,
};

/**
 * Mock for responseCleanup.stripResponseArtifacts
 */
export const mockStripResponseArtifacts: Mock = vi.fn((content: string) => content);

/**
 * Mock for responseCleanup.removeDuplicateResponse
 */
export const mockRemoveDuplicateResponse: Mock = vi.fn((content: string) => content);

export const mockResponseCleanup: {
  stripResponseArtifacts: Mock;
  removeDuplicateResponse: Mock;
} = {
  stripResponseArtifacts: mockStripResponseArtifacts,
  removeDuplicateResponse: mockRemoveDuplicateResponse,
};

/**
 * Mock for promptPlaceholders.replacePromptPlaceholders
 */
export const mockReplacePromptPlaceholders: Mock = vi.fn((content: string) => content);

export const mockPromptPlaceholders: { replacePromptPlaceholders: Mock } = {
  replacePromptPlaceholders: mockReplacePromptPlaceholders,
};

/**
 * Mock for errorHandling.logAndThrow
 */
export const mockLogAndThrow: Mock = vi.fn((_logger: unknown, _msg: string, error: unknown) => {
  throw error;
});

export const mockErrorHandling: { logAndThrow: Mock } = {
  logAndThrow: mockLogAndThrow,
};

/**
 * Reset all utility mocks
 */
export function resetUtilityMocks(): void {
  mockProcessAttachments.mockReset().mockResolvedValue([]);
  mockStripResponseArtifacts.mockReset().mockImplementation((content: string) => content);
  mockRemoveDuplicateResponse.mockReset().mockImplementation((content: string) => content);
  mockReplacePromptPlaceholders.mockReset().mockImplementation((content: string) => content);
  mockLogAndThrow
    .mockReset()
    .mockImplementation((_logger: unknown, _msg: string, error: unknown) => {
      throw error;
    });
}
