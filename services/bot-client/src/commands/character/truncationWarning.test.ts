/**
 * Tests for character truncation-warning flow
 *
 * Covers the three user-visible branches:
 * - detection picks up over-length fields per their modal maxLength
 * - the warning embed surfaces char counts + truncation amount
 * - the three buttons (Edit with Truncation / View Full / Cancel) route
 *   to handlers that each produce the expected Discord response shape
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';

// Mock common-types — logger, DISCORD_COLORS, isBotOwner, getConfig.
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: vi.fn().mockReturnValue({}),
  };
});

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

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: vi.fn().mockReturnValue(false),
  };
});

// Mock the character API to avoid gateway calls in tests.
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: {} })),
}));

const mockFetchCharacter = vi.fn();
vi.mock('./api.js', () => ({
  fetchCharacter: (...args: unknown[]) => mockFetchCharacter(...args),
}));

// Mock fetchOrCreateSession so the handlers see a stable data fixture.
// Mocks target the SOURCE modules, not the index re-export — vitest mocks
// the exact module path, and the source files import directly from their
// sources (per 02-code-standards.md on "no index-import indirection"),
// so mocking the index here would silently miss.
const mockFetchOrCreateSession = vi.fn();
vi.mock('../../utils/dashboard/sessionHelpers.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/dashboard/sessionHelpers.js')>();
  return {
    ...actual,
    fetchOrCreateSession: (...args: unknown[]) => mockFetchOrCreateSession(...args),
  };
});

// The real buildSectionModal returns a ModalBuilder; stub it so the
// handler tests don't depend on Discord.js modal internals.
vi.mock('../../utils/dashboard/ModalFactory.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/dashboard/ModalFactory.js')>();
  return {
    ...actual,
    buildSectionModal: vi.fn().mockReturnValue({ __modal: true }),
  };
});

// Import after mocks so the factory resolves before module load.
const {
  showTruncationWarning,
  handleEditTruncatedButton,
  handleOpenEditorButton,
  handleViewFullButton,
  handleCancelEditButton,
} = await import('./truncationWarning.js');
const { SectionStatus } = await import('../../utils/dashboard/index.js');

// A realistic character-identity section stub with two fields that have
// explicit maxLength values.
const identitySectionStub = {
  id: 'identity',
  label: '🏷️ Identity & Basics',
  description: 'test',
  fieldIds: ['personalityAge', 'personalityTraits'],
  fields: [
    { id: 'personalityAge', label: 'Age', maxLength: 100, style: 'short' as const },
    {
      id: 'personalityTraits',
      label: 'Traits',
      maxLength: 1000,
      style: 'paragraph' as const,
    },
  ],
  getStatus: () => SectionStatus.DEFAULT,
  getPreview: () => '',
};

describe('showTruncationWarning', () => {
  it('replies ephemerally with the warning embed and button row', async () => {
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const interaction = { reply: mockReply } as unknown as StringSelectMenuInteraction;

    await showTruncationWarning(interaction, identitySectionStub, 'char-1', [
      { fieldId: 'personalityAge', label: 'Age', current: 150, max: 100 },
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
      data: { name: 'Hero', _isAdmin: false },
    });
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockShowModal = vi.fn();
    const interaction = {
      user: { id: 'user-1' },
      update: mockUpdate,
      showModal: mockShowModal,
    } as unknown as ButtonInteraction;

    await handleEditTruncatedButton(interaction, 'char-1', 'identity');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockShowModal).not.toHaveBeenCalled();
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.embeds).toHaveLength(1);
    expect(updateArgs.components).toHaveLength(1);
  });

  it('warms the session AFTER the update ack, not before', async () => {
    // The update must precede the async resolveContext work. If this order
    // flips, we're back to the PR #825 R1 3-sec bug.
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Hero', _isAdmin: false },
    });
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      update: mockUpdate,
      showModal: vi.fn(),
    } as unknown as ButtonInteraction;

    await handleEditTruncatedButton(interaction, 'char-1', 'identity');

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockFetchOrCreateSession).toHaveBeenCalled();
    const updateOrder = mockUpdate.mock.invocationCallOrder[0];
    const fetchOrder = mockFetchOrCreateSession.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(fetchOrder);
  });

  it('swallows session-warm failures so the open_editor click can retry', async () => {
    // A failed warm shouldn't propagate to the user — step 2 has its own
    // resolveContext + 10062 fallback. Swallowing also prevents the
    // CommandHandler catch from surfacing a scary error on a successful update.
    mockFetchOrCreateSession.mockRejectedValue(new Error('Redis connection refused'));
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      update: mockUpdate,
      showModal: vi.fn(),
    } as unknown as ButtonInteraction;

    await expect(
      handleEditTruncatedButton(interaction, 'char-1', 'identity')
    ).resolves.toBeUndefined();
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('handles session-warm null returns without propagating (character-deleted race)', async () => {
    // Regression pin for PR #825 R8 #3: when resolveCharacterSectionContext
    // returns null (non-throwing failure path, e.g., character-deleted
    // between warning display and opt-in click), the handler must neither
    // throw, propagate the null, nor double-send a followUp. The "Ready
    // to edit" embed + sectionContext's internal followUp error is the
    // acceptable UX (strictly better than a silent 10062).
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
      handleEditTruncatedButton(interaction, 'char-1', 'identity')
    ).resolves.toBeUndefined();
    expect(mockUpdate).toHaveBeenCalled();
    // sectionContext's replyError sends the followUp; we don't double-send
    // from handleEditTruncatedButton's own logic.
    expect(mockFollowUp).toHaveBeenCalledTimes(1);
  });
});

describe('handleOpenEditorButton', () => {
  beforeEach(() => {
    mockFetchOrCreateSession.mockReset();
  });

  it('fetches the character and shows the section modal on success', async () => {
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Hero', _isAdmin: false },
    });
    const mockShowModal = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      showModal: mockShowModal,
    } as unknown as ButtonInteraction;

    await handleOpenEditorButton(interaction, 'char-1', 'identity');

    expect(mockShowModal).toHaveBeenCalledWith({ __modal: true });
  });

  it('replies with an error when the character cannot be fetched', async () => {
    mockFetchOrCreateSession.mockResolvedValue({ success: false });
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const mockShowModal = vi.fn();
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
      showModal: mockShowModal,
    } as unknown as ButtonInteraction;

    await handleOpenEditorButton(interaction, 'char-1', 'identity');

    expect(mockShowModal).not.toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Character not found'),
      })
    );
  });

  it('catches 10062 and surfaces a retry-visible followUp when the 3-sec window blows', async () => {
    // Residual failure mode: session warmed but Redis latency spike pushes
    // the open_editor ack past 3 sec. Discord returns 10062. The handler
    // must not silently die — it must attempt a user-visible followUp.
    const { DiscordAPIError } = await import('discord.js');
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Hero', _isAdmin: false },
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

    await handleOpenEditorButton(interaction, 'char-1', 'identity');

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
      data: { name: 'Hero', _isAdmin: false },
    });
    const unexpected = new Error('boom');
    const mockShowModal = vi.fn().mockRejectedValue(unexpected);
    const interaction = {
      user: { id: 'user-1' },
      showModal: mockShowModal,
      followUp: vi.fn(),
    } as unknown as ButtonInteraction;

    await expect(handleOpenEditorButton(interaction, 'char-1', 'identity')).rejects.toThrow('boom');
  });

  it('swallows secondary followUp failures after a 10062', async () => {
    // On a fully-dead interaction token, followUp also throws 10062. The
    // handler must not propagate that secondary failure to the outer
    // CommandHandler catch (which would re-log and re-attempt a send).
    const { DiscordAPIError } = await import('discord.js');
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Hero', _isAdmin: false },
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
      handleOpenEditorButton(interaction, 'char-1', 'identity')
    ).resolves.toBeUndefined();
    expect(mockFollowUp).toHaveBeenCalled();
  });
});

describe('handleViewFullButton', () => {
  beforeEach(() => {
    mockFetchOrCreateSession.mockReset();
  });

  /**
   * Build an interaction stub that models the deferReply → editReply
   * lifecycle: once deferReply is called, `deferred` flips true so
   * sectionContext's replyError predicate correctly routes errors to
   * followUp instead of reply.
   */
  function makeDeferrableInteraction(): {
    interaction: ButtonInteraction;
    deferReply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    followUp: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
  } {
    const state = { deferred: false, replied: false };
    const deferReply = vi.fn().mockImplementation(async () => {
      state.deferred = true;
    });
    const editReply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      deferReply,
      editReply,
      followUp,
      reply,
      get deferred() {
        return state.deferred;
      },
      get replied() {
        return state.replied;
      },
    } as unknown as ButtonInteraction;
    return { interaction, deferReply, editReply, followUp, reply };
  }

  it('defers within the 3-second window before any async work', async () => {
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { personalityAge: 'x'.repeat(150), _isAdmin: false },
    });
    const { interaction, deferReply } = makeDeferrableInteraction();

    await handleViewFullButton(interaction, 'char-1', 'identity');

    expect(deferReply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral })
    );
    // deferReply must fire before fetchOrCreateSession (the async work)
    expect(deferReply.mock.invocationCallOrder[0]).toBeLessThan(
      mockFetchOrCreateSession.mock.invocationCallOrder[0]
    );
  });

  it('editReplies with txt attachments for each over-length field', async () => {
    const longValue = 'x'.repeat(150);
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { personalityAge: longValue, _isAdmin: false },
    });
    const { interaction, editReply, reply } = makeDeferrableInteraction();

    await handleViewFullButton(interaction, 'char-1', 'identity');

    // Must use editReply, never reply — the interaction was deferred
    expect(reply).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        files: expect.arrayContaining([expect.any(Object)]),
        content: expect.stringContaining('Full content'),
      })
    );
    const callArg = editReply.mock.calls[0][0] as { files: unknown[] };
    expect(callArg.files).toHaveLength(1);
  });

  it('names attachments from user-facing labels, not internal field ids', async () => {
    // Regression guard for PR #825 R5 #2: filenames were exposing internal
    // field ids like `personalityAge.txt` to users. The safe-filename
    // conversion should produce `age.txt` from the "Age" label, and the
    // summary content should reference the same filename so users can
    // cross-reference the embed bullet list with the downloaded file.
    const longValue = 'x'.repeat(150);
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { personalityAge: longValue, _isAdmin: false },
    });
    const { interaction, editReply } = makeDeferrableInteraction();

    await handleViewFullButton(interaction, 'char-1', 'identity');

    const callArg = editReply.mock.calls[0][0] as {
      files: { name: string }[];
      content: string;
    };
    expect(callArg.files[0].name).toBe('age.txt');
    expect(callArg.files[0].name).not.toContain('personalityAge');
    // Summary text must reference the same filename
    expect(callArg.content).toContain('age.txt');
  });

  it('reports no-op via editReply when content no longer exceeds cap', async () => {
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { personalityAge: 'short', _isAdmin: false },
    });
    const { interaction, editReply } = makeDeferrableInteraction();

    await handleViewFullButton(interaction, 'char-1', 'identity');

    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('No fields') })
    );
    expect(editReply.mock.calls[0][0].files).toBeUndefined();
  });

  it('surfaces fetch-failure via editReply (sectionContext fills the deferred slot)', async () => {
    mockFetchOrCreateSession.mockResolvedValue({ success: false });
    const { interaction, editReply, followUp, reply } = makeDeferrableInteraction();

    await handleViewFullButton(interaction, 'char-1', 'identity');

    // After deferReply, sectionContext uses editReply to fill the deferred
    // slot (replaces the loading indicator with the error message) rather
    // than spawning a separate followUp that leaves the indicator dangling.
    expect(reply).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not found'),
      })
    );
  });
});

describe('handleCancelEditButton', () => {
  it('updates the ephemeral message to a cancellation notice', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const interaction = { update: mockUpdate } as unknown as ButtonInteraction;

    await handleCancelEditButton(interaction);

    expect(mockUpdate).toHaveBeenCalledWith({
      content: '✅ Edit cancelled.',
      embeds: [],
      components: [],
    });
  });
});
