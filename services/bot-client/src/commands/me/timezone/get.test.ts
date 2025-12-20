/**
 * Tests for Timezone Get Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTimezoneGet } from './get.js';
import { mockGetTimezoneResponse } from '@tzurot/common-types';

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

const mockCreateInfoEmbed = vi.fn((title: string, description?: string) =>
  createMockEmbed(title, description)
);

vi.mock('../../../utils/commandHelpers.js', () => ({
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
  createInfoEmbed: (...args: unknown[]) =>
    mockCreateInfoEmbed(...(args as [string, string | undefined])),
}));

describe('handleTimezoneGet', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateInfoEmbed.mockImplementation((title: string, description?: string) =>
      createMockEmbed(title, description)
    );
  });

  function createMockInteraction() {
    return {
      user: { id: '123456789' },
      options: {
        getString: () => null,
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleTimezoneGet>[0];
  }

  it('should get timezone successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockGetTimezoneResponse({ timezone: 'America/New_York', isDefault: false }),
    });

    const interaction = createMockInteraction();
    await handleTimezoneGet(interaction);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/timezone', {
      userId: '123456789',
    });
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({ data: expect.objectContaining({ title: '⏰ Your Timezone' }) }),
      ],
    });
  });

  it('should show default timezone message when using default', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockGetTimezoneResponse({ timezone: 'UTC', isDefault: true }),
    });

    const interaction = createMockInteraction();
    await handleTimezoneGet(interaction);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining('default timezone'),
          }),
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
    await handleTimezoneGet(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      'Failed to get timezone. Please try again later.'
    );
  });

  it('should handle exceptions', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    const interaction = createMockInteraction();
    await handleTimezoneGet(interaction);

    expect(mockHandleCommandError).toHaveBeenCalledWith(interaction, error, {
      userId: '123456789',
      command: 'Timezone Get',
    });
  });
});
