/**
 * Tests for resolveCharacterSectionContext
 *
 * Targets the shared preamble: admin resolution, section lookup, data
 * fetch, and the null-returning error paths for unknown sections and
 * missing characters. The downstream handlers (truncation warning,
 * section modal) have their own test files; here we isolate the
 * resolver's contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';

// Mock common-types logger + isBotOwner.
const mockIsBotOwner = vi.fn().mockReturnValue(false);
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
    isBotOwner: (...args: unknown[]) => mockIsBotOwner(...args),
    getConfig: vi.fn().mockReturnValue({}),
  };
});

const mockFetchCharacter = vi.fn();
vi.mock('./api.js', () => ({
  fetchCharacter: (...args: unknown[]) => mockFetchCharacter(...args),
}));

const mockFetchOrCreateSession = vi.fn();
vi.mock('../../utils/dashboard/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/dashboard/index.js')>();
  return {
    ...actual,
    fetchOrCreateSession: (...args: unknown[]) => mockFetchOrCreateSession(...args),
  };
});

const { resolveCharacterSectionContext } = await import('./sectionContext.js');

describe('resolveCharacterSectionContext', () => {
  beforeEach(() => {
    mockFetchOrCreateSession.mockReset();
    mockIsBotOwner.mockReturnValue(false);
  });

  it('returns the full bundle on success', async () => {
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { slug: 'hero', name: 'Hero', _isAdmin: false },
    });
    const mockReply = vi.fn();
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
    } as unknown as ButtonInteraction;

    const result = await resolveCharacterSectionContext(
      interaction,
      'hero',
      'identity',
      {} as never
    );

    expect(result).not.toBeNull();
    expect(result?.section.id).toBe('identity');
    expect(result?.isAdmin).toBe(false);
    expect(result?.data.name).toBe('Hero');
    expect(result?.context).toEqual({ isAdmin: false, userId: 'user-1' });
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('propagates admin status from isBotOwner into context + transform', async () => {
    mockIsBotOwner.mockReturnValue(true);
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { slug: 'hero', name: 'Hero', _isAdmin: true },
    });
    const interaction = {
      user: { id: 'admin-1' },
      reply: vi.fn(),
    } as unknown as ButtonInteraction;

    const result = await resolveCharacterSectionContext(
      interaction,
      'hero',
      'identity',
      {} as never
    );

    expect(result?.isAdmin).toBe(true);
    expect(result?.context.isAdmin).toBe(true);
    // Verify fetchOrCreateSession was invoked with the admin-tagged transform
    const invokeArgs = mockFetchOrCreateSession.mock.calls[0][0];
    const transformed = invokeArgs.transformFn({ slug: 'hero', name: 'Hero' });
    expect(transformed._isAdmin).toBe(true);
  });

  it('replies with "Unknown section" and returns null for a missing section id', async () => {
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
    } as unknown as StringSelectMenuInteraction;

    const result = await resolveCharacterSectionContext(
      interaction,
      'hero',
      'nonexistent-section-id',
      {} as never
    );

    expect(result).toBeNull();
    expect(mockReply).toHaveBeenCalledWith({
      content: '❌ Unknown section.',
      flags: MessageFlags.Ephemeral,
    });
    // Must NOT attempt to fetch the character when the section is unknown
    expect(mockFetchOrCreateSession).not.toHaveBeenCalled();
  });

  it('replies with "Character not found" and returns null when the fetch fails', async () => {
    mockFetchOrCreateSession.mockResolvedValue({ success: false });
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
    } as unknown as ButtonInteraction;

    const result = await resolveCharacterSectionContext(
      interaction,
      'hero',
      'identity',
      {} as never
    );

    expect(result).toBeNull();
    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not found'),
        flags: MessageFlags.Ephemeral,
      })
    );
  });
});
