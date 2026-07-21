/**
 * Tests for Voice Purge Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import {
  handlePurgeVoices,
  handleVoicePurgeButton,
  handleVoicePurgeModal,
  VOICE_PURGE_OPERATION,
} from './purge.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

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

const stub = {
  listVoices: vi.fn(),
  clearVoices: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

const mockBuildDestructiveWarning = vi.fn().mockReturnValue({ embeds: [], components: [] });
const mockHandleDestructiveConfirmButton = vi.fn();
const mockHandleDestructiveCancel = vi.fn();
const mockHandleDestructiveModalSubmit = vi.fn();
vi.mock('../../../utils/confirmation/confirmDestructive.js', () => ({
  buildDestructiveWarning: (...args: unknown[]) => mockBuildDestructiveWarning(...args),
  createHardDeleteConfig: (opts: Record<string, unknown>) => opts,
  hardDeleteModalDisplay: (entityName: string) => ({
    modalTitle: 'Confirm Deletion',
    confirmationLabel: `Type: DELETE ${entityName.toUpperCase()}`,
    confirmationPhrase: `DELETE ${entityName.toUpperCase()}`,
    confirmationPlaceholder: `DELETE ${entityName.toUpperCase()}`,
  }),
  handleDestructiveConfirmButton: (...args: unknown[]) =>
    mockHandleDestructiveConfirmButton(...args),
  handleDestructiveCancel: (...args: unknown[]) => mockHandleDestructiveCancel(...args),
  handleDestructiveModalSubmit: (...args: unknown[]) => mockHandleDestructiveModalSubmit(...args),
}));

vi.mock('../../../utils/customIds.js', () => ({
  DestructiveCustomIds: {
    parse: (customId: string) => {
      const parts = customId.split('::');
      if (parts.length < 4 || parts[1] !== 'destructive') return null;
      return {
        source: parts[0],
        action: parts[2],
        operation: parts[3],
        entityId: parts[4],
      };
    },
  },
}));

describe('handlePurgeVoices', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stub.listVoices.mockReset();
    stub.clearVoices.mockReset();
  });

  function createMockContext(): DeferredCommandContext {
    const mockInteraction = {
      user: { id: 'user-123' },
      editReply: mockEditReply,
    } as unknown as ChatInputCommandInteraction;

    return {
      interaction: mockInteraction,
      user: mockInteraction.user,
      guild: null,
      member: null,
      channel: null,
      channelId: 'channel-123',
      guildId: null,
      commandName: 'settings',
      isEphemeral: true,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('purge'),
      getSubcommandGroup: vi.fn().mockReturnValue('voices'),
    } as unknown as DeferredCommandContext;
  }

  it('should show destructive warning when voices exist', async () => {
    stub.listVoices.mockResolvedValue(
      makeOk({
        voices: [
          { voiceId: 'v1', name: 'tzurot-alice', slug: 'alice' },
          { voiceId: 'v2', name: 'tzurot-bob', slug: 'bob' },
        ],
        totalVoices: 10,
        tzurotCount: 2,
      })
    );

    await handlePurgeVoices(createMockContext());

    expect(mockBuildDestructiveWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'cloned voices',
        operation: VOICE_PURGE_OPERATION,
      })
    );
    expect(mockEditReply).toHaveBeenCalled();
  });

  it('warning entityName does not include a numeric count (avoids snapshot drift)', async () => {
    stub.listVoices.mockResolvedValue(
      makeOk({
        voices: [
          { voiceId: 'v1', name: 'tzurot-alice', slug: 'alice' },
          { voiceId: 'v2', name: 'tzurot-bob', slug: 'bob' },
        ],
        totalVoices: 10,
        tzurotCount: 2,
      })
    );

    await handlePurgeVoices(createMockContext());

    const callArg = mockBuildDestructiveWarning.mock.calls[0]?.[0] as
      { entityName?: string } | undefined;
    expect(callArg?.entityName).toBe('all your Tzurot voices');
    // Specifically, no digits — defends against regression where the count returns
    expect(callArg?.entityName).not.toMatch(/\d/);
  });

  it('should show message when no voices to clear', async () => {
    stub.listVoices.mockResolvedValue(makeOk({ voices: [], totalVoices: 5, tzurotCount: 0 }));

    await handlePurgeVoices(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: 'No Tzurot voices to purge.',
    });
    expect(mockBuildDestructiveWarning).not.toHaveBeenCalled();
  });

  it('should handle API error', async () => {
    stub.listVoices.mockResolvedValue(makeErr(404, 'ElevenLabs API key not found'));

    await handlePurgeVoices(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ ElevenLabs API key not found',
    });
  });

  it('should handle exceptions', async () => {
    stub.listVoices.mockRejectedValue(new Error('Network error'));

    await handlePurgeVoices(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to purge your voices. Please try again.',
    });
  });
});

describe('handleVoicePurgeButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle cancel button', async () => {
    const interaction = {
      customId: `voice::destructive::cancel_button::${VOICE_PURGE_OPERATION}::all`,
    } as unknown as ButtonInteraction;

    await handleVoicePurgeButton(interaction);

    expect(mockHandleDestructiveCancel).toHaveBeenCalledWith(interaction, 'Voice purge cancelled.');
  });

  it('should handle confirm button', async () => {
    const interaction = {
      customId: `voice::destructive::confirm_button::${VOICE_PURGE_OPERATION}::all`,
    } as unknown as ButtonInteraction;

    await handleVoicePurgeButton(interaction);

    expect(mockHandleDestructiveConfirmButton).toHaveBeenCalled();
  });
});

describe('handleVoicePurgeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.clearVoices.mockReset();
  });

  it('should handle modal submit', async () => {
    const interaction = {
      customId: `voice::destructive::modal_submit::${VOICE_PURGE_OPERATION}::all`,
      user: { id: 'user-123' },
    } as unknown as ModalSubmitInteraction;

    await handleVoicePurgeModal(interaction);

    expect(mockHandleDestructiveModalSubmit).toHaveBeenCalled();
  });

  it('invokes clearVoices via the typed client when the destructive callback runs', async () => {
    // The handler delegates to `handleDestructiveModalSubmit`, which decides
    // whether to run the inner callback. Drive the mock to invoke the
    // callback so the userClient.clearVoices closure is exercised.
    mockHandleDestructiveModalSubmit.mockImplementationOnce(
      async (_interaction, _word, callback) => {
        await callback();
      }
    );
    stub.clearVoices.mockResolvedValue({
      ok: true,
      data: { deleted: 3, total: 3 },
    });
    const interaction = {
      customId: `voice::destructive::modal_submit::${VOICE_PURGE_OPERATION}::all`,
      user: { id: 'user-123' },
    } as unknown as ModalSubmitInteraction;

    await handleVoicePurgeModal(interaction);

    expect(stub.clearVoices).toHaveBeenCalled();
  });
});
