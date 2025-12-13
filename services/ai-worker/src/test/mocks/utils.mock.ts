/**
 * Utility Function Mocks
 *
 * Simple function mocks for utilities that don't have complex class structures.
 */

import { vi } from 'vitest';

/**
 * Mock for MultimodalProcessor.processAttachments
 */
export const mockProcessAttachments = vi.fn().mockResolvedValue([]);

export const mockMultimodalProcessor = {
  processAttachments: mockProcessAttachments,
};

/**
 * Mock for responseCleanup.stripResponseArtifacts
 */
export const mockStripResponseArtifacts = vi.fn((content: string) => content);

export const mockResponseCleanup = {
  stripResponseArtifacts: mockStripResponseArtifacts,
};

/**
 * Mock for promptPlaceholders.replacePromptPlaceholders
 */
export const mockReplacePromptPlaceholders = vi.fn((content: string) => content);

export const mockPromptPlaceholders = {
  replacePromptPlaceholders: mockReplacePromptPlaceholders,
};

/**
 * Mock for errorHandling.logAndThrow
 */
export const mockLogAndThrow = vi.fn(
  (_logger: unknown, _msg: string, error: unknown) => {
    throw error;
  }
);

export const mockErrorHandling = {
  logAndThrow: mockLogAndThrow,
};

/**
 * Reset all utility mocks
 */
export function resetUtilityMocks(): void {
  mockProcessAttachments.mockReset().mockResolvedValue([]);
  mockStripResponseArtifacts.mockReset().mockImplementation((content: string) => content);
  mockReplacePromptPlaceholders.mockReset().mockImplementation((content: string) => content);
  mockLogAndThrow.mockReset().mockImplementation(
    (_logger: unknown, _msg: string, error: unknown) => {
      throw error;
    }
  );
}
