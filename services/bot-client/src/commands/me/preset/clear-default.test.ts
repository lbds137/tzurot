/**
 * Tests for Model Clear-Default Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleClearDefault } from './clear-default.js';
import { mockClearDefaultConfigResponse } from '@tzurot/common-types';

// Mock userGatewayClient
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

// Mock commandHelpers
vi.mock('../../../utils/commandHelpers.js', () => ({
  replyWithError: vi.fn().mockResolvedValue(undefined),
  handleCommandError: vi.fn().mockResolvedValue(undefined),
}));

import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { replyWithError, handleCommandError } from '../../../utils/commandHelpers.js';

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
  const mockCallGatewayApi = vi.mocked(callGatewayApi);
  const mockReplyWithError = vi.mocked(replyWithError);
  const mockHandleCommandError = vi.mocked(handleCommandError);

  beforeEach(() => {
    vi.clearAllMocks();
    mockEditReply.mockResolvedValue(undefined);
  });

  function createMockInteraction() {
    return {
      user: { id: '123456789' },
      editReply: mockEditReply,
    } as any;
  }

  it('should call gateway API with DELETE method', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockClearDefaultConfigResponse(),
    });

    await handleClearDefault(createMockInteraction());

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/model-override/default', {
      method: 'DELETE',
      userId: '123456789',
    });
  });

  it('should show success embed when config cleared', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockClearDefaultConfigResponse(),
    });

    await handleClearDefault(createMockInteraction());

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
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Internal server error',
    });

    await handleClearDefault(createMockInteraction());

    expect(mockReplyWithError).toHaveBeenCalledWith(
      expect.anything(),
      'Failed to clear default: Internal server error'
    );
  });

  it('should handle exceptions with handleCommandError', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    await handleClearDefault(createMockInteraction());

    expect(mockHandleCommandError).toHaveBeenCalledWith(expect.anything(), error, {
      userId: '123456789',
      command: 'Preset Clear-Default',
    });
  });
});
