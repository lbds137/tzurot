/**
 * Tests for Timezone Set Handler
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTimezoneSet } from './set.js';
import { mockSetTimezoneResponse } from '@tzurot/test-factories';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

// Mock common-types
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

const stub = {
  setTimezone: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
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

const mockCreateSuccessEmbed = vi.fn((title: string, description: string) =>
  createMockEmbed(title, description)
);

vi.mock('../../../utils/commandHelpers.js', () => ({
  createSuccessEmbed: (...args: unknown[]) => mockCreateSuccessEmbed(...(args as [string, string])),
}));

describe('handleTimezoneSet', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stub.setTimezone.mockReset();
    mockCreateSuccessEmbed.mockImplementation((title: string, description: string) =>
      createMockEmbed(title, description)
    );
  });

  function createMockContext(options: { timezone?: string } = {}) {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: {
        options: {
          getString: (name: string, _required?: boolean) => {
            if (name === 'timezone') return options.timezone ?? 'America/New_York';
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleTimezoneSet>[0];
  }

  it('should set timezone successfully', async () => {
    stub.setTimezone.mockResolvedValue(
      makeOk(mockSetTimezoneResponse({ timezone: 'America/New_York' }))
    );

    await handleTimezoneSet(createMockContext({ timezone: 'America/New_York' }));

    expect(stub.setTimezone).toHaveBeenCalledWith({ timezone: 'America/New_York' });
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({ title: '⏰ Timezone Updated' }),
        }),
      ],
    });
  });

  it('should handle API error', async () => {
    stub.setTimezone.mockResolvedValue(makeErr(500, 'Server error'));

    await handleTimezoneSet(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to set timezone: Server error',
    });
  });

  it('should handle exceptions', async () => {
    stub.setTimezone.mockRejectedValue(new Error('Network error'));

    await handleTimezoneSet(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
    });
  });
});
