/**
 * Tests for Dashboard Modal Submit Helpers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModalSubmitInteraction } from 'discord.js';
import { extractAndMergeSectionValues } from './modalHelpers.js';
import type { DashboardConfig, SectionDefinition } from './types.js';
import { SectionStatus } from './types.js';

// Mock extractModalValues from ModalFactory
vi.mock('./ModalFactory.js', () => ({
  extractModalValues: vi.fn(),
}));

// Import after mocking
import { extractModalValues } from './ModalFactory.js';

interface TestData {
  name: string;
  description: string;
  model: string;
}

const testSection: SectionDefinition<TestData> = {
  id: 'identity',
  label: '🏷️ Identity',
  fieldIds: ['name', 'description'],
  fields: [
    { id: 'name', label: 'Name', style: 'short' as const, required: true },
    { id: 'description', label: 'Description', style: 'paragraph' as const },
  ],
  getStatus: () => SectionStatus.COMPLETE,
  getPreview: (data: TestData) => data.name,
};

const testConfig: DashboardConfig<TestData> = {
  entityType: 'test',
  getTitle: (data: TestData) => data.name,
  sections: [testSection],
};

describe('extractAndMergeSectionValues', () => {
  const mockInteraction = {
    fields: {
      getTextInputValue: vi.fn(),
    },
  } as unknown as ModalSubmitInteraction;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should extract values and merge with current data', () => {
    vi.mocked(extractModalValues).mockReturnValue({
      name: 'Updated Name',
      description: 'New description',
    });

    const currentData: Partial<TestData> = {
      name: 'Old Name',
      model: 'gpt-4',
    };

    const result = extractAndMergeSectionValues(
      mockInteraction,
      testConfig,
      'identity',
      currentData
    );

    expect(result).not.toBeNull();
    expect(result!.section).toBe(testSection);
    expect(result!.merged).toEqual({
      name: 'Updated Name',
      description: 'New description',
      model: 'gpt-4',
    });
    expect(extractModalValues).toHaveBeenCalledWith(mockInteraction, ['name', 'description']);
  });

  it('should return null for unknown section', () => {
    const result = extractAndMergeSectionValues(mockInteraction, testConfig, 'nonexistent', {});

    expect(result).toBeNull();
    expect(extractModalValues).not.toHaveBeenCalled();
  });

  it('should handle empty current data', () => {
    vi.mocked(extractModalValues).mockReturnValue({
      name: 'New Name',
    });

    const result = extractAndMergeSectionValues(mockInteraction, testConfig, 'identity', {});

    expect(result).not.toBeNull();
    expect(result!.merged).toEqual({ name: 'New Name' });
  });
});
