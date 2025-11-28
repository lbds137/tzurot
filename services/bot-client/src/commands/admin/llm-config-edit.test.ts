/**
 * Tests for Admin LLM Config Edit Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleLlmConfigEdit } from './llm-config-edit.js';
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

describe('handleLlmConfigEdit', () => {
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
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'config') return 'config-id';
      if (name === 'name') return 'New Name';
      return null;
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ config: { id: 'config-id', name: 'New Name', model: 'test-model' } }),
        { status: 200 }
      )
    );

    await handleLlmConfigEdit(mockInteraction, mockConfig);

    expect(mockInteraction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show error when gateway URL not configured', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'config') return 'config-id';
      if (name === 'name') return 'New Name';
      return null;
    });

    const configWithoutGateway = { ...mockConfig, GATEWAY_URL: undefined };

    await handleLlmConfigEdit(
      mockInteraction,
      configWithoutGateway as ReturnType<typeof getConfig>
    );

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Gateway URL not configured'),
    });
  });

  it('should show error when no fields provided to update', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'config') return 'config-id';
      return null; // No update fields provided
    });

    await handleLlmConfigEdit(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('No fields to update'),
    });
  });

  it('should call API with correct update body', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'config') return 'config-id';
      if (name === 'name') return 'New Name';
      if (name === 'model') return 'new-model';
      if (name === 'provider') return 'openrouter';
      return null;
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ config: { id: 'config-id', name: 'New Name', model: 'new-model' } }),
        { status: 200 }
      )
    );

    await handleLlmConfigEdit(mockInteraction, mockConfig);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/admin/llm-config/config-id',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Admin-Key': 'test-admin-key',
        }),
        body: JSON.stringify({ name: 'New Name', model: 'new-model', provider: 'openrouter' }),
      })
    );
  });

  it('should display success embed on successful update', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'config') return 'config-id';
      if (name === 'name') return 'Updated Config';
      return null;
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          config: { id: 'config-id', name: 'Updated Config', model: 'test-model' },
        }),
        { status: 200 }
      )
    );

    await handleLlmConfigEdit(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle HTTP errors from API', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'config') return 'config-id';
      if (name === 'name') return 'New Name';
      return null;
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Config not found' }), { status: 404 })
    );

    await handleLlmConfigEdit(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Config not found'),
    });
  });

  it('should handle HTTP error without error message', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'config') return 'config-id';
      if (name === 'name') return 'New Name';
      return null;
    });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }));

    await handleLlmConfigEdit(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('HTTP 500'),
    });
  });

  it('should handle network errors', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'config') return 'config-id';
      if (name === 'name') return 'New Name';
      return null;
    });
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    await handleLlmConfigEdit(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('error occurred'),
    });
  });

  it('should include all provided fields in update body', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'config') return 'config-id';
      if (name === 'name') return 'New Name';
      if (name === 'model') return 'new-model';
      if (name === 'provider') return 'anthropic';
      if (name === 'description') return 'New description';
      if (name === 'vision-model') return 'vision-model';
      return null;
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ config: { id: 'config-id', name: 'New Name', model: 'new-model' } }),
        { status: 200 }
      )
    );

    await handleLlmConfigEdit(mockInteraction, mockConfig);

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          name: 'New Name',
          model: 'new-model',
          provider: 'anthropic',
          description: 'New description',
          visionModel: 'vision-model',
        }),
      })
    );
  });
});
