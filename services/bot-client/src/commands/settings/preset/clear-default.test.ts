/**
 * Tests for Preset Clear-Default Handler
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleClearDefault } from './clear-default.js';
import { mockClearDefaultConfigResponse } from '@tzurot/common-types';

// Mock userGatewayClient
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

import { callGatewayApi } from '../../../utils/userGatewayClient.js';

// Mock logger
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

describe('handleClearDefault', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockEditReply.mockResolvedValue(undefined);
  });

  function createMockContext() {
    return {
      user: { id: '123456789' },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleClearDefault>[0];
  }

  it('should call gateway API with DELETE method', async () => {
    vi.mocked(callGatewayApi).mockResolvedValue({
      ok: true,
      data: mockClearDefaultConfigResponse(),
    });

    await handleClearDefault(createMockContext());

    expect(callGatewayApi).toHaveBeenCalledWith('/user/model-override/default', {
      method: 'DELETE',
      userId: '123456789',
    });
  });

  it('should show success embed when config cleared', async () => {
    vi.mocked(callGatewayApi).mockResolvedValue({
      ok: true,
      data: mockClearDefaultConfigResponse(),
    });

    await handleClearDefault(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '✅ Default Preset Cleared',
          }),
        }),
      ],
    });
  });

  it('should show error when API fails', async () => {
    vi.mocked(callGatewayApi).mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Internal server error',
    });

    await handleClearDefault(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to clear default: Internal server error',
    });
  });

  it('should handle exceptions', async () => {
    vi.mocked(callGatewayApi).mockRejectedValue(new Error('Network error'));

    await handleClearDefault(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
    });
  });
});
