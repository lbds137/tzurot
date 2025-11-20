/**
 * Tests for Personality Edit Subcommand Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleEdit } from './edit.js';
import type { ChatInputCommandInteraction, User, Attachment } from 'discord.js';
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

// Mock avatar processor
vi.mock('../../utils/avatarProcessor.js', () => ({
  processAvatarAttachment: vi.fn(),
  AvatarProcessingError: class AvatarProcessingError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AvatarProcessingError';
    }
  },
}));

// Mock fetch
global.fetch = vi.fn();

import { processAvatarAttachment, AvatarProcessingError } from '../../utils/avatarProcessor.js';

describe('handleEdit', () => {
  let mockInteraction: ChatInputCommandInteraction;
  let mockConfig: ReturnType<typeof getConfig>;
  let mockUser: User;

  beforeEach(() => {
    vi.clearAllMocks();

    mockUser = {
      id: 'user-123',
      tag: 'TestUser#1234',
    } as User;

    mockInteraction = {
      user: mockUser,
      options: {
        getString: vi.fn(),
        getAttachment: vi.fn(),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    mockConfig = {
      GATEWAY_URL: 'http://localhost:3000',
    } as ReturnType<typeof getConfig>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should defer reply with ephemeral flag', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'slug') return 'test-personality';
      if (name === 'name') return 'Updated Name';
      return null;
    });
    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await handleEdit(mockInteraction, mockConfig);

    expect(mockInteraction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should require at least one field to update', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'slug') return 'test-personality';
      return null;
    });
    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(null);

    await handleEdit(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ You must provide at least one field to update')
    );
  });

  it('should update name field', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'slug') return 'test-personality';
      if (name === 'name') return 'Updated Name';
      return null;
    });
    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await handleEdit(mockInteraction, mockConfig);

    expect(fetch).toHaveBeenCalled();
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);
    expect(body.name).toBe('Updated Name');
  });

  it('should update multiple fields', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'slug') return 'test-personality';
      if (name === 'name') return 'Updated Name';
      if (name === 'tone') return 'Updated Tone';
      if (name === 'age') return 'Updated Age';
      return null;
    });
    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await handleEdit(mockInteraction, mockConfig);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);
    expect(body.name).toBe('Updated Name');
    expect(body.personalityTone).toBe('Updated Tone');
    expect(body.personalityAge).toBe('Updated Age');
  });

  it('should process avatar attachment if provided', async () => {
    const mockAttachment = {
      url: 'https://example.com/avatar.png',
      name: 'avatar.png',
    } as Attachment;

    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'slug') return 'test-personality';
      return null;
    });
    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(mockAttachment);
    vi.mocked(processAvatarAttachment).mockResolvedValue('data:image/png;base64,abc123');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await handleEdit(mockInteraction, mockConfig);

    expect(processAvatarAttachment).toHaveBeenCalledWith(mockAttachment, 'Personality Edit');
  });

  it('should handle avatar processing errors', async () => {
    const mockAttachment = {
      url: 'https://example.com/avatar.png',
      name: 'avatar.png',
    } as Attachment;

    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'slug') return 'test-personality';
      return null;
    });
    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(mockAttachment);
    vi.mocked(processAvatarAttachment).mockRejectedValue(
      new AvatarProcessingError('❌ Avatar file too large')
    );

    await handleEdit(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith('❌ Avatar file too large');
  });

  it('should send PATCH request to gateway', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'slug') return 'test-personality';
      if (name === 'name') return 'Updated Name';
      return null;
    });
    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await handleEdit(mockInteraction, mockConfig);

    expect(fetch).toHaveBeenCalledWith(
      `${mockConfig.GATEWAY_URL}/admin/personality/test-personality`,
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Owner-Id': 'user-123',
        }),
      })
    );
  });

  it('should handle 404 not found errors', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'slug') return 'nonexistent';
      if (name === 'name') return 'Updated Name';
      return null;
    });
    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(new Response('Not Found', { status: 404 }));

    await handleEdit(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Personality with slug')
    );
  });

  it('should handle HTTP errors', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'slug') return 'test-personality';
      if (name === 'name') return 'Updated Name';
      return null;
    });
    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

    await handleEdit(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Failed to edit personality')
    );
  });

  it('should include owner ID in payload', async () => {
    vi.mocked(mockInteraction.options.getString).mockImplementation((name: string) => {
      if (name === 'slug') return 'test-personality';
      if (name === 'name') return 'Updated Name';
      return null;
    });
    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await handleEdit(mockInteraction, mockConfig);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);

    expect(body.ownerId).toBe('user-123');
  });
});
