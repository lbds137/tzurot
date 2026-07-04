/**
 * Tests for persona truncation-warning flow.
 *
 * Mirrors `commands/character/truncationWarning.test.ts` but with
 * persona's data resolver and the persona entityType in custom IDs.
 * Detection / embed / button-shape unit tests live in the shared
 * truncationGate test files; this file covers persona-specific
 * handler behavior (two-click flow ordering, 10062 catch, 3-sec budget).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
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

vi.mock('../../utils/dashboard/ModalFactory.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/dashboard/ModalFactory.js')>();
  return {
    ...actual,
    buildSectionModal: vi.fn().mockReturnValue({ __modal: true }),
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

const {
  showTruncationWarning,
  handleEditTruncatedButton,
  handleOpenEditorButton,
  handleViewFullButton,
  handleCancelEditButton,
} = await import('./truncationWarning.js');
const { SectionStatus } = await import('../../utils/dashboard/index.js');

const identitySectionStub = {
  id: 'identity',
  label: '📝 Persona Info',
  description: 'test',
  fieldIds: ['name', 'content'],
  fields: [
    { id: 'name', label: 'Name', maxLength: 100, style: 'short' as const },
    { id: 'content', label: 'About You', maxLength: 4000, style: 'paragraph' as const },
  ],
  getStatus: () => SectionStatus.DEFAULT,
  getPreview: () => '',
};

describe('showTruncationWarning', () => {
  it('replies ephemerally with the warning embed and persona-typed buttons', async () => {
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const interaction = { reply: mockReply } as unknown as StringSelectMenuInteraction;

    await showTruncationWarning(interaction, identitySectionStub, 'persona-1', [
      { fieldId: 'content', label: 'About You', current: 4500, max: 4000 },
    ]);

    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        embeds: expect.arrayContaining([expect.any(Object)]),
        components: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });
});

describe('handleEditTruncatedButton', () => {
  beforeEach(() => {
    mockFetchOrCreateSession.mockReset();
  });

  it('updates the interaction to the Ready-to-Edit state with an Open Editor button', async () => {
    // Step 1 of the two-click flow must `update` first (no showModal) so
    // the 3-second budget is never blown by the subsequent session warm.
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Tester', content: 'about me' },
    });
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockShowModal = vi.fn();
    const interaction = {
      user: { id: 'user-1' },
      update: mockUpdate,
      showModal: mockShowModal,
    } as unknown as ButtonInteraction;

    await handleEditTruncatedButton(interaction, 'persona-1', 'identity');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockShowModal).not.toHaveBeenCalled();
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.embeds).toHaveLength(1);
    expect(updateArgs.components).toHaveLength(1);
  });

  it('warms the session AFTER the update ack, not before', async () => {
    // The update must precede the async resolveContext work. If this order
    // flips, we're back to the PR #825 R1 3-sec bug class.
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Tester', content: 'about me' },
    });
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      update: mockUpdate,
      showModal: vi.fn(),
    } as unknown as ButtonInteraction;

    await handleEditTruncatedButton(interaction, 'persona-1', 'identity');

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockFetchOrCreateSession).toHaveBeenCalled();
    const updateOrder = mockUpdate.mock.invocationCallOrder[0];
    const fetchOrder = mockFetchOrCreateSession.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(fetchOrder);
  });

  it('swallows session-warm failures so the open_editor click can retry', async () => {
    mockFetchOrCreateSession.mockRejectedValue(new Error('Redis connection refused'));
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      update: mockUpdate,
      showModal: vi.fn(),
    } as unknown as ButtonInteraction;

    await expect(
      handleEditTruncatedButton(interaction, 'persona-1', 'identity')
    ).resolves.toBeUndefined();
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('returns early after update when sectionId does not match any section', async () => {
    // Reachable when a button arrives with `persona::edit_truncated::id::unknown`.
    // findPersonaSection returns null; the function still acks via update
    // (using sectionId as the fallback label) and returns early without
    // touching the session warm. Pins the early-return contract so a
    // future refactor can't accidentally drop the ack.
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      update: mockUpdate,
      showModal: vi.fn(),
    } as unknown as ButtonInteraction;

    await handleEditTruncatedButton(interaction, 'persona-1', 'unknown-section-id');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockFetchOrCreateSession).not.toHaveBeenCalled();
  });

  it('handles session-warm null returns without propagating (persona-deleted race)', async () => {
    mockFetchOrCreateSession.mockResolvedValue({ success: false });
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockFollowUp = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      update: mockUpdate,
      showModal: vi.fn(),
      followUp: mockFollowUp,
      get deferred() {
        return false;
      },
      get replied() {
        return true; // interaction.update sets replied=true
      },
    } as unknown as ButtonInteraction;

    await expect(
      handleEditTruncatedButton(interaction, 'persona-1', 'identity')
    ).resolves.toBeUndefined();
    expect(mockUpdate).toHaveBeenCalled();
    // sectionContext's replyError sends the followUp.
    expect(mockFollowUp).toHaveBeenCalledTimes(1);
  });
});

describe('handleOpenEditorButton', () => {
  beforeEach(() => {
    mockFetchOrCreateSession.mockReset();
  });

  it('fetches the persona and shows the section modal on success', async () => {
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Tester', content: 'about me' },
    });
    const mockShowModal = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      showModal: mockShowModal,
    } as unknown as ButtonInteraction;

    await handleOpenEditorButton(interaction, 'persona-1', 'identity');

    expect(mockShowModal).toHaveBeenCalledWith({ __modal: true });
  });

  it('replies with an error when the persona cannot be fetched', async () => {
    mockFetchOrCreateSession.mockResolvedValue({ success: false });
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const mockShowModal = vi.fn();
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
      showModal: mockShowModal,
    } as unknown as ButtonInteraction;

    await handleOpenEditorButton(interaction, 'persona-1', 'identity');

    expect(mockShowModal).not.toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Persona not found'),
      })
    );
  });

  it('catches 10062 and surfaces a retry-visible followUp when the 3-sec window blows', async () => {
    const { DiscordAPIError } = await import('discord.js');
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Tester', content: 'about me' },
    });
    const timeoutError = new DiscordAPIError(
      { code: 10062, message: 'Unknown interaction' },
      10062,
      404,
      'POST',
      '/interactions/x/y/callback',
      {}
    );
    const mockShowModal = vi.fn().mockRejectedValue(timeoutError);
    const mockFollowUp = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      showModal: mockShowModal,
      followUp: mockFollowUp,
    } as unknown as ButtonInteraction;

    await handleOpenEditorButton(interaction, 'persona-1', 'identity');

    expect(mockShowModal).toHaveBeenCalled();
    expect(mockFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Took too long'),
        flags: MessageFlags.Ephemeral,
      })
    );
  });

  it('rethrows non-10062 showModal errors so the global catch can handle them', async () => {
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Tester', content: 'about me' },
    });
    const unexpected = new Error('boom');
    const mockShowModal = vi.fn().mockRejectedValue(unexpected);
    const interaction = {
      user: { id: 'user-1' },
      showModal: mockShowModal,
      followUp: vi.fn(),
    } as unknown as ButtonInteraction;

    await expect(handleOpenEditorButton(interaction, 'persona-1', 'identity')).rejects.toThrow(
      'boom'
    );
  });

  it('swallows secondary followUp failures after a 10062', async () => {
    const { DiscordAPIError } = await import('discord.js');
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Tester', content: 'about me' },
    });
    const timeoutError = new DiscordAPIError(
      { code: 10062, message: 'Unknown interaction' },
      10062,
      404,
      'POST',
      '/interactions/x/y/callback',
      {}
    );
    const mockShowModal = vi.fn().mockRejectedValue(timeoutError);
    const mockFollowUp = vi.fn().mockRejectedValue(timeoutError);
    const interaction = {
      user: { id: 'user-1' },
      showModal: mockShowModal,
      followUp: mockFollowUp,
    } as unknown as ButtonInteraction;

    await expect(
      handleOpenEditorButton(interaction, 'persona-1', 'identity')
    ).resolves.toBeUndefined();
    expect(mockFollowUp).toHaveBeenCalled();
  });
});

describe('handleViewFullButton', () => {
  beforeEach(() => {
    mockFetchOrCreateSession.mockReset();
  });

  function makeDeferrableInteraction(): {
    interaction: ButtonInteraction;
    deferReply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    followUp: ReturnType<typeof vi.fn>;
  } {
    const state = { deferred: false, replied: false };
    const deferReply = vi.fn().mockImplementation(async () => {
      state.deferred = true;
    });
    const editReply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      deferReply,
      editReply,
      followUp,
      get deferred() {
        return state.deferred;
      },
      get replied() {
        return state.replied;
      },
    } as unknown as ButtonInteraction;
    return { interaction, deferReply, editReply, followUp };
  }

  it('defers the reply BEFORE any async resolveContext work', async () => {
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Tester', content: 'x'.repeat(4500) },
    });
    const { interaction, deferReply, editReply } = makeDeferrableInteraction();

    await handleViewFullButton(interaction, 'persona-1', 'identity');

    expect(deferReply).toHaveBeenCalled();
    expect(editReply).toHaveBeenCalled();
    const deferOrder = deferReply.mock.invocationCallOrder[0];
    const fetchOrder = mockFetchOrCreateSession.mock.invocationCallOrder[0];
    expect(deferOrder).toBeLessThan(fetchOrder);
  });

  it('attaches over-length field content as `.txt` files', async () => {
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Tester', content: 'x'.repeat(4500) },
    });
    const { interaction, editReply } = makeDeferrableInteraction();

    await handleViewFullButton(interaction, 'persona-1', 'identity');

    const editArgs = editReply.mock.calls[0][0];
    expect(editArgs.files).toHaveLength(1);
    // Real config field label is 'About You (shared with AI)'; toSafeFilename
    // strips the parens and joins on underscores.
    expect(editArgs.files[0].name).toBe('about_you_shared_with_ai.txt');
  });

  it('shows "nothing to display" when data shrank between warning and View Full', async () => {
    // Concurrent-edit race: a parallel save trimmed `content` below the cap
    // between the warning showing and the user clicking View Full.
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Tester', content: 'tiny' },
    });
    const { interaction, editReply } = makeDeferrableInteraction();

    await handleViewFullButton(interaction, 'persona-1', 'identity');

    const editArgs = editReply.mock.calls[0][0];
    expect(editArgs.content).toContain('No fields');
    expect(editArgs.files).toBeUndefined();
  });

  it('surfaces fetch-failure via editReply (sectionContext fills the deferred slot)', async () => {
    mockFetchOrCreateSession.mockResolvedValue({ success: false });
    const { interaction, editReply, followUp } = makeDeferrableInteraction();

    await handleViewFullButton(interaction, 'persona-1', 'identity');

    // sectionContext.replyError uses editReply on a deferred-but-not-replied
    // interaction to fill the loading slot, not followUp (which would leave
    // the "Thinking…" indicator dangling).
    expect(followUp).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Persona'),
      })
    );
  });
});

describe('handleCancelEditButton', () => {
  it('updates the interaction to the cancelled state', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const interaction = { update: mockUpdate } as unknown as ButtonInteraction;

    await handleCancelEditButton(interaction);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('cancelled'),
        embeds: [],
        components: [],
      })
    );
  });
});
