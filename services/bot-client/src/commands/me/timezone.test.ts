/**
 * Tests for Timezone Subcommand Handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTimezoneSet, handleTimezoneGet } from './timezone.js';

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
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Mock commandHelpers
const mockDeferEphemeral = vi.fn();
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
const mockCreateInfoEmbed = vi.fn((title: string, description?: string) =>
  createMockEmbed(title, description)
);

vi.mock('../../utils/commandHelpers.js', () => ({
  deferEphemeral: (...args: unknown[]) => mockDeferEphemeral(...args),
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
  createSuccessEmbed: (...args: unknown[]) => mockCreateSuccessEmbed(...(args as [string, string])),
  createInfoEmbed: (...args: unknown[]) =>
    mockCreateInfoEmbed(...(args as [string, string | undefined])),
}));

describe('Timezone Subcommands', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock embed creators to return fresh mocks
    mockCreateSuccessEmbed.mockImplementation((title: string, description: string) =>
      createMockEmbed(title, description)
    );
    mockCreateInfoEmbed.mockImplementation((title: string, description?: string) =>
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

  describe('handleTimezoneSet', () => {
    it('should set timezone successfully', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { timezone: 'America/New_York' },
      });

      const interaction = createMockInteraction({ timezone: 'America/New_York' });
      await handleTimezoneSet(interaction);

      expect(mockDeferEphemeral).toHaveBeenCalledWith(interaction);
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

  describe('handleTimezoneGet', () => {
    it('should get timezone successfully', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { timezone: 'America/New_York', isDefault: false },
      });

      const interaction = createMockInteraction();
      await handleTimezoneGet(interaction);

      expect(mockDeferEphemeral).toHaveBeenCalledWith(interaction);
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
        data: { timezone: 'UTC', isDefault: true },
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
});
