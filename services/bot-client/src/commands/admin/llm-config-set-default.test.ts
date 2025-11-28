/**
 * Tests for Admin LLM Config Set Default Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleLlmConfigSetDefault } from './llm-config-set-default.js';
import type { ChatInputCommandInteraction, User } from 'discord.js';
import { MessageFlags } from 'discord.js';

// Mock logger and config
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
    getConfig: () => ({
      GATEWAY_URL: 'http://localhost:3000',
      INTERNAL_SERVICE_SECRET: 'test-service-secret',
    }),
  };
});

// Mock fetch
global.fetch = vi.fn();

describe('handleLlmConfigSetDefault', () => {
  let mockInteraction: ChatInputCommandInteraction;
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should defer reply with ephemeral flag', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('config-id');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ configName: 'Test Config' }), { status: 200 })
    );

    await handleLlmConfigSetDefault(mockInteraction);

    expect(mockInteraction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should call API with correct endpoint and method', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('config-id-123');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ configName: 'Test Config' }), { status: 200 })
    );

    await handleLlmConfigSetDefault(mockInteraction);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/admin/llm-config/config-id-123/set-default',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Service-Auth': 'test-service-secret',
        }),
      })
    );
  });

  it('should display success embed on successful update', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('config-id');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ configName: 'Default Config' }), { status: 200 })
    );

    await handleLlmConfigSetDefault(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle HTTP errors from API', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('config-id');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Config not found' }), { status: 404 })
    );

    await handleLlmConfigSetDefault(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Config not found'),
    });
  });

  it('should handle HTTP error without error message', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('config-id');
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }));

    await handleLlmConfigSetDefault(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('HTTP 500'),
    });
  });

  it('should handle network errors', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('config-id');
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    await handleLlmConfigSetDefault(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('error occurred'),
    });
  });
});
