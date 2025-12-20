/**
 * Tests for History Hard-Delete Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleHardDelete, parseHardDeleteEntityId } from './hard-delete.js';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock destructiveConfirmation
const mockBuildDestructiveWarning = vi.fn();
const mockCreateHardDeleteConfig = vi.fn(() => ({
  source: 'history',
  operation: 'hard-delete',
  entityId: 'lilith|channel-123',
}));
vi.mock('../../utils/destructiveConfirmation.js', () => ({
  buildDestructiveWarning: (...args: unknown[]) => mockBuildDestructiveWarning(...args),
  createHardDeleteConfig: (...args: unknown[]) => mockCreateHardDeleteConfig(...args),
}));

// Mock commandHelpers
const mockHandleCommandError = vi.fn();
vi.mock('../../utils/commandHelpers.js', () => ({
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
}));

describe('handleHardDelete', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildDestructiveWarning.mockReturnValue({
      embeds: [{ data: { title: 'Delete History' } }],
      components: [{ data: {} }],
    });
  });

  function createMockInteraction(
    personalitySlug: string = 'lilith',
    channelId: string = 'channel-123'
  ) {
    return {
      user: { id: '123456789' },
      channelId,
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'personality') return personalitySlug;
          return null;
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleHardDelete>[0];
  }

  it('should show destructive warning with danger button', async () => {
    const interaction = createMockInteraction();
    await handleHardDelete(interaction);

    expect(mockCreateHardDeleteConfig).toHaveBeenCalledWith({
      entityType: 'conversation history',
      entityName: 'lilith',
      additionalWarning: expect.stringContaining('PERMANENT'),
      source: 'history',
      operation: 'hard-delete',
      entityId: 'lilith|channel-123',
    });
    expect(mockBuildDestructiveWarning).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('should include channelId in entityId', async () => {
    const interaction = createMockInteraction('test-personality', 'channel-456');
    await handleHardDelete(interaction);

    expect(mockCreateHardDeleteConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'test-personality|channel-456',
      })
    );
  });

  it('should handle exceptions', async () => {
    mockBuildDestructiveWarning.mockImplementation(() => {
      throw new Error('Build error');
    });

    const interaction = createMockInteraction();
    await handleHardDelete(interaction);

    expect(mockHandleCommandError).toHaveBeenCalledWith(interaction, expect.any(Error), {
      userId: '123456789',
      command: 'History Hard-Delete',
    });
  });
});

describe('parseHardDeleteEntityId', () => {
  it('should parse valid entityId', () => {
    const result = parseHardDeleteEntityId('lilith|channel-123');

    expect(result).toEqual({
      personalitySlug: 'lilith',
      channelId: 'channel-123',
    });
  });

  it('should handle entityId with complex personality slug', () => {
    const result = parseHardDeleteEntityId('my-custom-personality|123456789012345678');

    expect(result).toEqual({
      personalitySlug: 'my-custom-personality',
      channelId: '123456789012345678',
    });
  });

  it('should return null for invalid entityId (no separator)', () => {
    const result = parseHardDeleteEntityId('lilith-channel-123');

    expect(result).toBeNull();
  });

  it('should return null for invalid entityId (too many separators)', () => {
    const result = parseHardDeleteEntityId('lilith|channel|123');

    expect(result).toBeNull();
  });

  it('should return null for empty entityId', () => {
    const result = parseHardDeleteEntityId('');

    expect(result).toBeNull();
  });

  it('should return null for entityId with only separator', () => {
    const result = parseHardDeleteEntityId('|');

    expect(result).toEqual({
      personalitySlug: '',
      channelId: '',
    });
  });

  it('should handle single-part entityId', () => {
    const result = parseHardDeleteEntityId('lilith');

    expect(result).toBeNull();
  });
});
