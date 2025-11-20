/**
 * Tests for Personality Modal Submit Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleModalSubmit } from './modal.js';
import type { ModalSubmitInteraction, User } from 'discord.js';
import { MessageFlags } from 'discord.js';
import type { getConfig } from '@tzurot/common-types';

// Mock logger and constants
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
    TEXT_LIMITS: {
      PERSONALITY_PREVIEW: 200,
    },
  };
});

// Mock fetch
global.fetch = vi.fn();

describe('handleModalSubmit', () => {
  let mockInteraction: ModalSubmitInteraction;
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
      customId: 'personality-create',
      fields: {
        getTextInputValue: vi.fn(),
      },
      reply: vi.fn().mockResolvedValue(undefined),
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    mockConfig = {
      GATEWAY_URL: 'http://localhost:3000',
    } as ReturnType<typeof getConfig>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should reject unknown modal submission', async () => {
    mockInteraction.customId = 'unknown-modal';

    await handleModalSubmit(mockInteraction, mockConfig);

    expect(mockInteraction.reply).toHaveBeenCalledWith({
      content: '❌ Unknown modal submission',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should defer reply with ephemeral flag for personality-create', async () => {
    vi.mocked(mockInteraction.fields.getTextInputValue).mockImplementation((id: string) => {
      if (id === 'name') return 'Test Personality';
      if (id === 'slug') return 'test-personality';
      if (id === 'characterInfo') return 'Test info';
      if (id === 'personalityTraits') return 'Test traits';
      if (id === 'displayName') return '';
      return '';
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await handleModalSubmit(mockInteraction, mockConfig);

    expect(mockInteraction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should validate slug format', async () => {
    vi.mocked(mockInteraction.fields.getTextInputValue).mockImplementation((id: string) => {
      if (id === 'name') return 'Test Personality';
      if (id === 'slug') return 'Invalid_Slug!';
      if (id === 'characterInfo') return 'Test info';
      if (id === 'personalityTraits') return 'Test traits';
      if (id === 'displayName') return '';
      return '';
    });

    await handleModalSubmit(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Invalid slug format')
    );
  });

  it('should create personality with valid input', async () => {
    vi.mocked(mockInteraction.fields.getTextInputValue).mockImplementation((id: string) => {
      if (id === 'name') return 'Test Personality';
      if (id === 'slug') return 'test-personality';
      if (id === 'characterInfo') return 'Test info';
      if (id === 'personalityTraits') return 'Test traits';
      if (id === 'displayName') return '';
      return '';
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await handleModalSubmit(mockInteraction, mockConfig);

    expect(fetch).toHaveBeenCalledWith(
      `${mockConfig.GATEWAY_URL}/admin/personality`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Owner-Id': 'user-123',
        }),
      })
    );
  });

  it('should include display name if provided', async () => {
    vi.mocked(mockInteraction.fields.getTextInputValue).mockImplementation((id: string) => {
      if (id === 'name') return 'Test Personality';
      if (id === 'slug') return 'test-personality';
      if (id === 'characterInfo') return 'Test info';
      if (id === 'personalityTraits') return 'Test traits';
      if (id === 'displayName') return 'Display Name';
      return '';
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await handleModalSubmit(mockInteraction, mockConfig);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);

    expect(body.displayName).toBe('Display Name');
  });

  it('should handle 409 conflict', async () => {
    vi.mocked(mockInteraction.fields.getTextInputValue).mockImplementation((id: string) => {
      if (id === 'name') return 'Test Personality';
      if (id === 'slug') return 'existing-slug';
      if (id === 'characterInfo') return 'Test info';
      if (id === 'personalityTraits') return 'Test traits';
      if (id === 'displayName') return '';
      return '';
    });
    vi.mocked(fetch).mockResolvedValue(new Response('Conflict', { status: 409 }));

    await handleModalSubmit(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ A personality with the slug')
    );
  });

  it('should handle HTTP errors', async () => {
    vi.mocked(mockInteraction.fields.getTextInputValue).mockImplementation((id: string) => {
      if (id === 'name') return 'Test Personality';
      if (id === 'slug') return 'test-personality';
      if (id === 'characterInfo') return 'Test info';
      if (id === 'personalityTraits') return 'Test traits';
      if (id === 'displayName') return '';
      return '';
    });
    vi.mocked(fetch).mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

    await handleModalSubmit(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Failed to create personality')
    );
  });

  it('should include owner ID in payload', async () => {
    vi.mocked(mockInteraction.fields.getTextInputValue).mockImplementation((id: string) => {
      if (id === 'name') return 'Test Personality';
      if (id === 'slug') return 'test-personality';
      if (id === 'characterInfo') return 'Test info';
      if (id === 'personalityTraits') return 'Test traits';
      if (id === 'displayName') return '';
      return '';
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await handleModalSubmit(mockInteraction, mockConfig);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);

    expect(body.ownerId).toBe('user-123');
  });

  it('should show success embed on successful creation', async () => {
    vi.mocked(mockInteraction.fields.getTextInputValue).mockImplementation((id: string) => {
      if (id === 'name') return 'Test Personality';
      if (id === 'slug') return 'test-personality';
      if (id === 'characterInfo') return 'Test info';
      if (id === 'personalityTraits') return 'Test traits';
      if (id === 'displayName') return '';
      return '';
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await handleModalSubmit(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.objectContaining({})],
    });
  });
});
