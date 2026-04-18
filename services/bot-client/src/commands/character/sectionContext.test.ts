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

// Mock path is the SOURCE module, not the index re-export — vitest mocks
// the exact module path, and sectionContext.ts imports directly from
// sessionHelpers.js (per 02-code-standards.md on "no index-import indirection").
const mockFetchOrCreateSession = vi.fn();
vi.mock('../../utils/dashboard/sessionHelpers.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/dashboard/sessionHelpers.js')>();
  return {
    ...actual,
    fetchOrCreateSession: (...args: unknown[]) => mockFetchOrCreateSession(...args),
  };
});

const { resolveCharacterSectionContext, findCharacterSection, loadCharacterSectionData } =
  await import('./sectionContext.js');

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

  it('routes error replies through followUp when the caller already deferred', async () => {
    // Simulates `handleViewFullButton`, which `deferReply`s before calling
    // this helper. The helper must detect `interaction.deferred` and use
    // `followUp` — `reply()` on a deferred interaction throws.
    mockFetchOrCreateSession.mockResolvedValue({ success: false });
    const mockFollowUp = vi.fn().mockResolvedValue(undefined);
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      deferred: true,
      replied: false,
      followUp: mockFollowUp,
      reply: mockReply,
    } as unknown as ButtonInteraction;

    const result = await resolveCharacterSectionContext(
      interaction,
      'hero',
      'identity',
      {} as never
    );

    expect(result).toBeNull();
    expect(mockReply).not.toHaveBeenCalled();
    expect(mockFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not found'),
        flags: MessageFlags.Ephemeral,
      })
    );
  });
});

describe('findCharacterSection (sync helper)', () => {
  beforeEach(() => {
    mockIsBotOwner.mockReturnValue(false);
  });

  it('returns the full sync bundle for a known section', () => {
    const result = findCharacterSection('identity', 'user-1');
    expect(result).not.toBeNull();
    expect(result?.section.id).toBe('identity');
    expect(result?.isAdmin).toBe(false);
    expect(result?.context).toEqual({ isAdmin: false, userId: 'user-1' });
  });

  it('returns null for unknown section id (no side effects)', () => {
    // Sync helper must not touch the interaction — callers decide what
    // to do about the null. This is what lets step 1 of the edit flow
    // call it pre-update without blowing the 3-sec budget on an
    // error reply.
    const result = findCharacterSection('nonexistent-section', 'user-1');
    expect(result).toBeNull();
  });

  it('propagates admin status from isBotOwner', () => {
    mockIsBotOwner.mockReturnValue(true);
    const result = findCharacterSection('identity', 'admin-1');
    expect(result?.isAdmin).toBe(true);
    expect(result?.context.isAdmin).toBe(true);
  });
});

describe('loadCharacterSectionData (async helper with pre-resolved sync bundle)', () => {
  beforeEach(() => {
    mockFetchOrCreateSession.mockReset();
    mockIsBotOwner.mockReturnValue(false);
  });

  it('fetches data and returns the full context bundle on success', async () => {
    // Regression pin for PR #825 R9: the split exists to let callers
    // do the sync resolution once and reuse it, avoiding a second
    // getCharacterDashboardConfig build. This test confirms the async
    // path accepts a pre-built sync bundle and returns the merged
    // context without re-deriving the config.
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { slug: 'hero', name: 'Hero', _isAdmin: false },
    });
    const sync = findCharacterSection('identity', 'user-1');
    expect(sync).not.toBeNull();
    if (sync === null) return;

    const interaction = {
      user: { id: 'user-1' },
      reply: vi.fn(),
    } as unknown as ButtonInteraction;

    const result = await loadCharacterSectionData(interaction, 'hero', {} as never, sync);
    expect(result).not.toBeNull();
    expect(result?.data.name).toBe('Hero');
    // Same bundle fields — no second dashboardConfig build.
    expect(result?.dashboardConfig).toBe(sync.dashboardConfig);
    expect(result?.section).toBe(sync.section);
  });

  it('sends "Character not found" on fetch failure and returns null', async () => {
    mockFetchOrCreateSession.mockResolvedValue({ success: false });
    const sync = findCharacterSection('identity', 'user-1');
    if (sync === null) throw new Error('sync resolution should not fail');

    const mockReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
    } as unknown as ButtonInteraction;

    const result = await loadCharacterSectionData(interaction, 'hero', {} as never, sync);
    expect(result).toBeNull();
    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not found') })
    );
  });
});
