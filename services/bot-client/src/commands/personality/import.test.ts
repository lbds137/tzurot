/**
 * Tests for Personality Import Subcommand Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleImport } from './import.js';
import type { ChatInputCommandInteraction, User, Attachment } from 'discord.js';
import { MessageFlags } from 'discord.js';
import type { getConfig } from '@tzurot/common-types';

// Mock logger and DISCORD_LIMITS
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
    DISCORD_LIMITS: {
      AVATAR_SIZE: 10 * 1024 * 1024, // 10MB
    },
  };
});

// Mock fetch
global.fetch = vi.fn();

describe('handleImport', () => {
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
    const validJson = JSON.stringify({
      name: 'Test',
      slug: 'test',
      characterInfo: 'Info',
      personalityTraits: 'Traits',
    });

    const mockAttachment = {
      url: 'https://example.com/personality.json',
      name: 'personality.json',
      contentType: 'application/json',
      size: 1000,
    } as Attachment;

    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(mockAttachment);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(validJson, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await handleImport(mockInteraction, mockConfig);

    expect(mockInteraction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should validate file is JSON', async () => {
    const mockAttachment = {
      url: 'https://example.com/file.txt',
      name: 'file.txt',
      contentType: 'text/plain',
      size: 1000,
    } as Attachment;

    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(mockAttachment);

    await handleImport(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      '❌ File must be a JSON file (.json)'
    );
  });

  it('should validate file size', async () => {
    const mockAttachment = {
      url: 'https://example.com/large.json',
      name: 'large.json',
      contentType: 'application/json',
      size: 11 * 1024 * 1024, // 11MB
    } as Attachment;

    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(mockAttachment);

    await handleImport(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      '❌ File is too large (max 10MB)'
    );
  });

  it('should handle invalid JSON', async () => {
    const mockAttachment = {
      url: 'https://example.com/invalid.json',
      name: 'invalid.json',
      contentType: 'application/json',
      size: 1000,
    } as Attachment;

    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(mockAttachment);
    vi.mocked(fetch).mockResolvedValue(
      new Response('not valid json', { status: 200 })
    );

    await handleImport(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Failed to parse JSON file')
    );
  });

  it('should validate required fields', async () => {
    const missingFieldsJson = JSON.stringify({
      name: 'Test',
      slug: 'test',
      // Missing characterInfo and personalityTraits
    });

    const mockAttachment = {
      url: 'https://example.com/incomplete.json',
      name: 'incomplete.json',
      contentType: 'application/json',
      size: 1000,
    } as Attachment;

    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(mockAttachment);
    vi.mocked(fetch).mockResolvedValue(
      new Response(missingFieldsJson, { status: 200 })
    );

    await handleImport(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Missing required fields')
    );
  });

  it('should validate slug format', async () => {
    const invalidSlugJson = JSON.stringify({
      name: 'Test',
      slug: 'Invalid_Slug!',
      characterInfo: 'Info',
      personalityTraits: 'Traits',
    });

    const mockAttachment = {
      url: 'https://example.com/invalid-slug.json',
      name: 'invalid-slug.json',
      contentType: 'application/json',
      size: 1000,
    } as Attachment;

    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(mockAttachment);
    vi.mocked(fetch).mockResolvedValue(
      new Response(invalidSlugJson, { status: 200 })
    );

    await handleImport(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Invalid slug format')
    );
  });

  it('should import personality with valid JSON', async () => {
    const validJson = JSON.stringify({
      name: 'Test Personality',
      slug: 'test-personality',
      characterInfo: 'Test info',
      personalityTraits: 'Test traits',
    });

    const mockAttachment = {
      url: 'https://example.com/personality.json',
      name: 'personality.json',
      contentType: 'application/json',
      size: 1000,
    } as Attachment;

    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(mockAttachment);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(validJson, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await handleImport(mockInteraction, mockConfig);

    expect(fetch).toHaveBeenCalledWith(
      `${mockConfig.GATEWAY_URL}/admin/personality`,
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('should handle 409 conflict (slug exists)', async () => {
    const validJson = JSON.stringify({
      name: 'Test',
      slug: 'existing-slug',
      characterInfo: 'Info',
      personalityTraits: 'Traits',
    });

    const mockAttachment = {
      url: 'https://example.com/personality.json',
      name: 'personality.json',
      contentType: 'application/json',
      size: 1000,
    } as Attachment;

    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(mockAttachment);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(validJson, { status: 200 }))
      .mockResolvedValueOnce(new Response('Conflict', { status: 409 }));

    await handleImport(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ A personality with the slug')
    );
  });

  it('should handle HTTP errors', async () => {
    const validJson = JSON.stringify({
      name: 'Test',
      slug: 'test',
      characterInfo: 'Info',
      personalityTraits: 'Traits',
    });

    const mockAttachment = {
      url: 'https://example.com/personality.json',
      name: 'personality.json',
      contentType: 'application/json',
      size: 1000,
    } as Attachment;

    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(mockAttachment);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(validJson, { status: 200 }))
      .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));

    await handleImport(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Failed to import personality')
    );
  });

  it('should include owner ID in payload', async () => {
    const validJson = JSON.stringify({
      name: 'Test',
      slug: 'test',
      characterInfo: 'Info',
      personalityTraits: 'Traits',
    });

    const mockAttachment = {
      url: 'https://example.com/personality.json',
      name: 'personality.json',
      contentType: 'application/json',
      size: 1000,
    } as Attachment;

    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(mockAttachment);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(validJson, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await handleImport(mockInteraction, mockConfig);

    const createCall = vi.mocked(fetch).mock.calls[1]; // Second call is to create personality
    const body = JSON.parse(createCall[1]?.body as string);

    expect(body.ownerId).toBe('user-123');
  });

  it('should include optional fields if provided', async () => {
    const fullJson = JSON.stringify({
      name: 'Test',
      slug: 'test',
      characterInfo: 'Info',
      personalityTraits: 'Traits',
      displayName: 'Display',
      personalityTone: 'Tone',
      personalityAge: 'Age',
    });

    const mockAttachment = {
      url: 'https://example.com/full.json',
      name: 'full.json',
      contentType: 'application/json',
      size: 1000,
    } as Attachment;

    vi.mocked(mockInteraction.options.getAttachment).mockReturnValue(mockAttachment);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(fullJson, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await handleImport(mockInteraction, mockConfig);

    const createCall = vi.mocked(fetch).mock.calls[1];
    const body = JSON.parse(createCall[1]?.body as string);

    expect(body.displayName).toBe('Display');
    expect(body.personalityTone).toBe('Tone');
    expect(body.personalityAge).toBe('Age');
  });
});
