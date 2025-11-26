/**
 * Tests for LLM Config List Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleList } from './list.js';

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
vi.mock('../../utils/commandHelpers.js', () => ({
  deferEphemeral: (...args: unknown[]) => mockDeferEphemeral(...args),
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
}));

describe('handleList', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction() {
    return {
      user: { id: '123456789' },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleList>[0];
  }

  it('should list configs with global and user configs', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        configs: [
          { id: '1', name: 'Default', model: 'anthropic/claude-sonnet-4', isGlobal: true, isDefault: true, isOwned: false },
          { id: '2', name: 'Fast', model: 'openai/gpt-4o-mini', isGlobal: true, isDefault: false, isOwned: false },
          { id: '3', name: 'MyConfig', model: 'anthropic/claude-opus-4', isGlobal: false, isDefault: false, isOwned: true },
        ],
      },
    });

    const interaction = createMockInteraction();
    await handleList(interaction);

    expect(mockDeferEphemeral).toHaveBeenCalledWith(interaction);
    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/llm-config', { userId: '123456789' });
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [expect.objectContaining({
        data: expect.objectContaining({
          title: '🔧 LLM Configurations',
          fields: expect.arrayContaining([
            expect.objectContaining({ name: '🌐 Global Configs' }),
            expect.objectContaining({ name: '👤 Your Configs' }),
          ]),
        }),
      })],
    });
  });

  it('should show message when no configs exist', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { configs: [] },
    });

    const interaction = createMockInteraction();
    await handleList(interaction);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [expect.objectContaining({
        data: expect.objectContaining({
          description: expect.stringContaining('No configurations available'),
        }),
      })],
    });
  });

  it('should handle API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Server error',
    });

    const interaction = createMockInteraction();
    await handleList(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      'Failed to get configs. Please try again later.'
    );
  });

  it('should handle exceptions', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    const interaction = createMockInteraction();
    await handleList(interaction);

    expect(mockHandleCommandError).toHaveBeenCalledWith(
      interaction,
      error,
      { userId: '123456789', command: 'LlmConfig List' }
    );
  });
});
