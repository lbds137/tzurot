/**
 * Tests for the persona section-context resolver.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

// sectionContext.ts now calls `clientsFor(interaction)` to mint a userClient
// before delegating to fetchPersona. The fetchPersona mock above intercepts
// any actual client usage, but clientsFor itself must be stubbed because it
// reads INTERNAL_SERVICE_SECRET from config at construction time.
const clientsForMock = vi.hoisted(() => vi.fn(() => ({ userClient: {} })));
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

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

  it('uses editReply when interaction is deferred-but-not-replied', async () => {
    // After deferReply but before any actual response, the deferred slot
    // is "Thinking…" and editReply fills it. Using followUp here would
    // leave the loading indicator dangling and spawn a separate message.
    mockFetchOrCreateSession.mockResolvedValue({ success: false });
    const mockReply = vi.fn();
    const mockEditReply = vi.fn().mockResolvedValue(undefined);
    const mockFollowUp = vi.fn();
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
      editReply: mockEditReply,
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
    expect(mockFollowUp).not.toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Persona') })
    );
  });

  it('uses followUp when interaction has already been replied to', async () => {
    // After interaction.update() (which sets `replied=true`), an additional
    // ephemeral error message should use followUp, not editReply (which
    // would replace the original visible response).
    mockFetchOrCreateSession.mockResolvedValue({ success: false });
    const mockReply = vi.fn();
    const mockEditReply = vi.fn();
    const mockFollowUp = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
      editReply: mockEditReply,
      followUp: mockFollowUp,
      get deferred() {
        return false;
      },
      get replied() {
        return true;
      },
    } as unknown as ButtonInteraction;
    const sync = findPersonaSection('identity')!;

    await loadPersonaSectionData(interaction, 'persona-1', sync);
    expect(mockReply).not.toHaveBeenCalled();
    expect(mockEditReply).not.toHaveBeenCalled();
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
