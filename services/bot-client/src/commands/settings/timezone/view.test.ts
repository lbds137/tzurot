/**
 * Tests for Timezone View Handler
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTimezoneView } from './view.js';
import { mockGetTimezoneResponse } from '@tzurot/test-factories';
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
  getTimezone: vi.fn(),
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

const mockCreateInfoEmbed = vi.fn((title: string, description?: string) =>
  createMockEmbed(title, description)
);

vi.mock('../../../utils/commandHelpers.js', () => ({
  createInfoEmbed: (...args: unknown[]) =>
    mockCreateInfoEmbed(...(args as [string, string | undefined])),
}));

describe('handleTimezoneView', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stub.getTimezone.mockReset();
    mockCreateInfoEmbed.mockImplementation((title: string, description?: string) =>
      createMockEmbed(title, description)
    );
  });

  function createMockContext() {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: {} as never,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleTimezoneView>[0];
  }

  it('should get timezone successfully', async () => {
    stub.getTimezone.mockResolvedValue(
      makeOk(mockGetTimezoneResponse({ timezone: 'America/New_York', isDefault: false }))
    );

    await handleTimezoneView(createMockContext());

    expect(stub.getTimezone).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({ data: expect.objectContaining({ title: '⏰ Your Timezone' }) }),
      ],
    });
  });

  it('should show default timezone message when using default', async () => {
    stub.getTimezone.mockResolvedValue(
      makeOk(mockGetTimezoneResponse({ timezone: 'UTC', isDefault: true }))
    );

    await handleTimezoneView(createMockContext());

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
    stub.getTimezone.mockResolvedValue(makeErr(500, 'Server error'));

    await handleTimezoneView(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Server error',
    });
  });

  it('renders read-shaped copy on a timeout — never a write-outcome claim', async () => {
    // kind 'timeout' hits the read/write branch the http-kind pins bypass; a
    // pure GET must never render "your change may still be applying".
    stub.getTimezone.mockResolvedValue(makeErr(0, 'timed out', undefined, 'timeout'));

    const context = createMockContext();
    await handleTimezoneView(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as { content: string };
    expect(call.content).not.toContain('may still be applying');
    expect(call.content).not.toContain('was saved');
  });

  it('should handle exceptions', async () => {
    stub.getTimezone.mockRejectedValue(new Error('Network error'));

    await handleTimezoneView(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to fetch your timezone. Please try again.',
    });
  });
});
