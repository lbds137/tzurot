/**
 * Tests for Timezone Set Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTimezoneSet } from './set.js';
import { mockSetTimezoneResponse } from '@tzurot/common-types';

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

// Mock userGatewayClient
const mockCallGatewayApi = vi.fn();
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Mock commandHelpers
const mockReplyWithError = vi.fn();
const mockHandleCommandError = vi.fn();

// Create mock EmbedBuilder-like objects
function createMockEmbed(title: string, description?: string) {
  const data: Record<string, unknown> = { title };
  if (description !== undefined) {
    data.description = description;
  }

  const embed = {
    data,
    addFields: vi.fn().mockReturnThis(),
    setFooter: vi.fn().mockReturnThis(),
    setTimestamp: vi.fn().mockReturnThis(),
  };

  // Update data when methods are called
  embed.addFields.mockImplementation((field: { name: string; value: string }) => {
    data.fields = [field];
    return embed;
  });

  return embed;
}

const mockCreateSuccessEmbed = vi.fn((title: string, description: string) =>
  createMockEmbed(title, description)
);

vi.mock('../../../utils/commandHelpers.js', () => ({
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
  createSuccessEmbed: (...args: unknown[]) => mockCreateSuccessEmbed(...(args as [string, string])),
}));

describe('handleTimezoneSet', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSuccessEmbed.mockImplementation((title: string, description: string) =>
      createMockEmbed(title, description)
    );
  });

  function createMockInteraction(options: { timezone?: string } = {}) {
    return {
      user: { id: '123456789' },
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'timezone') return options.timezone ?? 'America/New_York';
          return null;
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleTimezoneSet>[0];
  }

  it('should set timezone successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockSetTimezoneResponse({ timezone: 'America/New_York' }),
    });

    const interaction = createMockInteraction({ timezone: 'America/New_York' });
    await handleTimezoneSet(interaction);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/timezone', {
      method: 'PUT',
      userId: '123456789',
      body: { timezone: 'America/New_York' },
    });
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({ title: '⏰ Timezone Updated' }),
        }),
      ],
    });
  });

  it('should handle API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Server error',
    });

    const interaction = createMockInteraction();
    await handleTimezoneSet(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      'Failed to set timezone: Server error'
    );
  });

  it('should handle exceptions', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    const interaction = createMockInteraction();
    await handleTimezoneSet(interaction);

    expect(mockHandleCommandError).toHaveBeenCalledWith(interaction, error, {
      userId: '123456789',
      command: 'Timezone Set',
    });
  });
});
