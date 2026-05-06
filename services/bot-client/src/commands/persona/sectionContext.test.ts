/**
 * Tests for the persona section-context resolver.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';

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

const mockFetchPersona = vi.fn();
vi.mock('./api.js', () => ({
  fetchPersona: (...args: unknown[]) => mockFetchPersona(...args),
}));

const mockFetchOrCreateSession = vi.fn();
vi.mock('../../utils/dashboard/sessionHelpers.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/dashboard/sessionHelpers.js')>();
  return {
    ...actual,
    fetchOrCreateSession: (...args: unknown[]) => mockFetchOrCreateSession(...args),
  };
});

const { findPersonaSection, loadPersonaSectionData, resolvePersonaSectionContext } =
  await import('./sectionContext.js');

describe('findPersonaSection', () => {
  it('returns the section when sectionId matches', () => {
    const result = findPersonaSection('identity');
    expect(result).not.toBeNull();
    expect(result?.section.id).toBe('identity');
  });

  it('returns null when sectionId is unknown', () => {
    const result = findPersonaSection('does-not-exist');
    expect(result).toBeNull();
  });
});

describe('loadPersonaSectionData', () => {
  it('returns context with data on successful session fetch', async () => {
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Tester', content: 'About me' },
    });
    const interaction = {
      user: { id: 'user-1' },
      get deferred() {
        return false;
      },
      get replied() {
        return false;
      },
    } as unknown as ButtonInteraction;
    const sync = findPersonaSection('identity');
    expect(sync).not.toBeNull();

    const result = await loadPersonaSectionData(interaction, 'persona-1', sync!);
    expect(result).not.toBeNull();
    expect(result?.data.name).toBe('Tester');
  });

  it('replies error and returns null when session fetch fails (fresh interaction)', async () => {
    mockFetchOrCreateSession.mockResolvedValue({ success: false });
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
      get deferred() {
        return false;
      },
      get replied() {
        return false;
      },
    } as unknown as ButtonInteraction;
    const sync = findPersonaSection('identity')!;

    const result = await loadPersonaSectionData(interaction, 'persona-1', sync);
    expect(result).toBeNull();
    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Persona') })
    );
  });

  it('uses followUp instead of reply when interaction is already deferred', async () => {
    mockFetchOrCreateSession.mockResolvedValue({ success: false });
    const mockReply = vi.fn();
    const mockFollowUp = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
      followUp: mockFollowUp,
      get deferred() {
        return true;
      },
      get replied() {
        return false;
      },
    } as unknown as ButtonInteraction;
    const sync = findPersonaSection('identity')!;

    await loadPersonaSectionData(interaction, 'persona-1', sync);
    expect(mockReply).not.toHaveBeenCalled();
    expect(mockFollowUp).toHaveBeenCalled();
  });
});

describe('resolvePersonaSectionContext', () => {
  it('replies with unknown-section error when sectionId is unknown', async () => {
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
      get deferred() {
        return false;
      },
      get replied() {
        return false;
      },
    } as unknown as StringSelectMenuInteraction;

    const result = await resolvePersonaSectionContext(interaction, 'persona-1', 'no-such-section');
    expect(result).toBeNull();
    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Unknown section') })
    );
  });

  it('returns full context on success', async () => {
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Tester', content: 'About me' },
    });
    const interaction = {
      user: { id: 'user-1' },
      get deferred() {
        return false;
      },
      get replied() {
        return false;
      },
    } as unknown as StringSelectMenuInteraction;

    const result = await resolvePersonaSectionContext(interaction, 'persona-1', 'identity');
    expect(result).not.toBeNull();
    expect(result?.section.id).toBe('identity');
    expect(result?.data.name).toBe('Tester');
  });
});
