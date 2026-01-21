/**
 * Tests for Override Clear Handler
 * Tests gateway API calls for clearing per-personality profile overrides.
 *
 * Uses validated mock factories from @tzurot/common-types to ensure
 * test mocks match actual gateway API responses.
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOverrideClear } from './override-clear.js';
import { mockClearOverrideResponse } from '@tzurot/common-types';

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

describe('handleOverrideClear', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(personalitySlug: string) {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: {
        options: {
          getString: (name: string) => {
            if (name === 'personality') return personalitySlug;
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleOverrideClear>[0];
  }

  it('should clear override successfully', async () => {
    // Use validated factory - ensures mock matches actual gateway response
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockClearOverrideResponse({
        personality: { name: 'Lilith', displayName: 'Lilith' },
        hadOverride: true,
      }),
    });

    await handleOverrideClear(createMockContext('lilith'));

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/override/lilith', {
      userId: '123456789',
      method: 'DELETE',
    });
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile override cleared'),
    });
  });

  it('should inform user if no override exists', async () => {
    // Use validated factory with hadOverride: false
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockClearOverrideResponse({
        personality: { name: 'Lilith', displayName: 'Lilith' },
        hadOverride: false,
      }),
    });

    await handleOverrideClear(createMockContext('lilith'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have a profile override"),
    });
  });

  it('should error if personality not found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Personality not found',
    });

    await handleOverrideClear(createMockContext('nonexistent'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Personality "nonexistent" not found'),
    });
  });

  it('should error if user not found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'User has no account yet',
    });

    await handleOverrideClear(createMockContext('lilith'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an account yet"),
    });
  });

  it('should handle gateway errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleOverrideClear(createMockContext('lilith'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to clear profile override'),
    });
  });
});
