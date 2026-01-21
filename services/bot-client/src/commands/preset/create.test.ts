/**
 * Tests for Preset Create Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCreate } from './create.js';
import { mockCreateLlmConfigResponse } from '@tzurot/common-types';

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

// Note: Handlers now use context.editReply() directly, not commandHelpers

describe('handleCreate', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(
    options: {
      name?: string;
      model?: string;
      description?: string | null;
      provider?: string | null;
      visionModel?: string | null;
    } = {}
  ) {
    return {
      user: { id: '123456789' },
      interaction: {
        options: {
          getString: (name: string, _required?: boolean) => {
            switch (name) {
              case 'name':
                return options.name ?? 'MyPreset';
              case 'model':
                return options.model ?? 'anthropic/claude-sonnet-4';
              case 'description':
                return options.description ?? null;
              case 'provider':
                return options.provider ?? null;
              case 'vision-model':
                return options.visionModel ?? null;
              default:
                return null;
            }
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleCreate>[0];
  }

  it('should create preset successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockCreateLlmConfigResponse({
        id: 'cfg-123',
        name: 'MyPreset',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
      }),
    });

    const context = createMockContext();
    await handleCreate(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/llm-config', {
      method: 'POST',
      userId: '123456789',
      body: {
        name: 'MyPreset',
        model: 'anthropic/claude-sonnet-4',
        description: null,
        provider: 'openrouter',
        visionModel: null,
      },
    });
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '✅ Preset Created',
            description: expect.stringContaining('MyPreset'),
          }),
        }),
      ],
    });
  });

  it('should use custom provider when specified', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockCreateLlmConfigResponse({
        id: 'cfg-123',
        name: 'GeminiPreset',
        model: 'gemini-2.0-flash',
        provider: 'gemini',
      }),
    });

    const context = createMockContext({
      name: 'GeminiPreset',
      model: 'gemini-2.0-flash',
      provider: 'gemini',
    });
    await handleCreate(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/llm-config', {
      method: 'POST',
      userId: '123456789',
      body: expect.objectContaining({ provider: 'gemini' }),
    });
  });

  it('should handle API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Name already exists',
    });

    const context = createMockContext();
    await handleCreate(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to create preset: Name already exists',
    });
  });

  it('should handle exceptions', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    const context = createMockContext();
    await handleCreate(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
    });
  });
});
