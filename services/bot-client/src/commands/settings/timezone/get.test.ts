/**
 * Tests for Timezone Get Handler
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
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
  GATEWAY_TIMEOUTS: { AUTOCOMPLETE: 2500, DEFERRED: 10000 },
}));

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

  function createMockContext() {
    return {
      user: { id: '123456789' },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleTimezoneGet>[0];
  }

  it('should get timezone successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockGetTimezoneResponse({ timezone: 'America/New_York', isDefault: false }),
    });

    await handleTimezoneGet(createMockContext());

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/timezone',
      expect.objectContaining({ userId: '123456789' })
    );
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

    await handleTimezoneGet(createMockContext());

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

    await handleTimezoneGet(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to get timezone. Please try again later.',
    });
  });

  it('should handle exceptions', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleTimezoneGet(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
    });
  });
});
