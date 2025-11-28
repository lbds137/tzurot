/**
 * Tests for Admin LLM Config Create Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleLlmConfigCreate } from './llm-config-create.js';
import type { ChatInputCommandInteraction, User } from 'discord.js';
import { MessageFlags } from 'discord.js';
import type { getConfig } from '@tzurot/common-types';

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock fetch
global.fetch = vi.fn();

describe('handleLlmConfigCreate', () => {
  let mockInteraction: ChatInputCommandInteraction;
  let mockConfig: ReturnType<typeof getConfig>;
  let mockUser: User;

  beforeEach(() => {
    vi.clearAllMocks();

    mockUser = {
      id: 'user-123',
    } as User;

    mockInteraction = {
      user: mockUser,
      options: {
        getString: vi.fn(),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    mockConfig = {
      GATEWAY_URL: 'http://localhost:3000',
      ADMIN_API_KEY: 'test-admin-key',
    } as ReturnType<typeof getConfig>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should defer reply with ephemeral flag', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation(
      (name: string, required?: boolean) => {
        if (name === 'name') return 'Test Config';
        if (name === 'model') return 'anthropic/claude-sonnet-4';
        return null;
      }
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          config: { id: 'config-id', name: 'Test Config', model: 'anthropic/claude-sonnet-4' },
        }),
        { status: 201 }
      )
    );

    await handleLlmConfigCreate(mockInteraction, mockConfig);

    expect(mockInteraction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show error when gateway URL not configured', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation(
      (name: string, required?: boolean) => {
        if (name === 'name') return 'Test Config';
        if (name === 'model') return 'test-model';
        return null;
      }
    );

    const configWithoutGateway = { ...mockConfig, GATEWAY_URL: undefined };

    await handleLlmConfigCreate(
      mockInteraction,
      configWithoutGateway as ReturnType<typeof getConfig>
    );

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Gateway URL not configured'),
    });
  });

  it('should call API with correct body', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation(
      (name: string, required?: boolean) => {
        if (name === 'name') return 'Test Config';
        if (name === 'model') return 'anthropic/claude-sonnet-4';
        if (name === 'provider') return 'anthropic';
        if (name === 'description') return 'A test config';
        if (name === 'vision-model') return 'vision-model';
        return null;
      }
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          config: { id: 'config-id', name: 'Test Config', model: 'anthropic/claude-sonnet-4' },
        }),
        { status: 201 }
      )
    );

    await handleLlmConfigCreate(mockInteraction, mockConfig);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/admin/llm-config',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Admin-Key': 'test-admin-key',
        }),
        body: JSON.stringify({
          name: 'Test Config',
          model: 'anthropic/claude-sonnet-4',
          provider: 'anthropic',
          description: 'A test config',
          visionModel: 'vision-model',
        }),
      })
    );
  });

  it('should display success embed on successful creation', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation(
      (name: string, required?: boolean) => {
        if (name === 'name') return 'Test Config';
        if (name === 'model') return 'test-model';
        return null;
      }
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ config: { id: 'config-id', name: 'Test Config', model: 'test-model' } }),
        { status: 201 }
      )
    );

    await handleLlmConfigCreate(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle HTTP errors from API', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation(
      (name: string, required?: boolean) => {
        if (name === 'name') return 'Test Config';
        if (name === 'model') return 'test-model';
        return null;
      }
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Config already exists' }), { status: 400 })
    );

    await handleLlmConfigCreate(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Config already exists'),
    });
  });

  it('should handle HTTP error without error message', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation(
      (name: string, required?: boolean) => {
        if (name === 'name') return 'Test Config';
        if (name === 'model') return 'test-model';
        return null;
      }
    );
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }));

    await handleLlmConfigCreate(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('HTTP 500'),
    });
  });

  it('should handle network errors', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation(
      (name: string, required?: boolean) => {
        if (name === 'name') return 'Test Config';
        if (name === 'model') return 'test-model';
        return null;
      }
    );
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    await handleLlmConfigCreate(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('error occurred'),
    });
  });

  it('should use default provider when null and include null optional fields', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation(
      (name: string, required?: boolean) => {
        if (name === 'name') return 'Test Config';
        if (name === 'model') return 'test-model';
        // provider defaults to 'openrouter', description and vision-model are null
        return null;
      }
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ config: { id: 'config-id', name: 'Test Config', model: 'test-model' } }),
        { status: 201 }
      )
    );

    await handleLlmConfigCreate(mockInteraction, mockConfig);

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          name: 'Test Config',
          model: 'test-model',
          provider: 'openrouter', // Default value when null
          description: null,
          visionModel: null,
        }),
      })
    );
  });
});
