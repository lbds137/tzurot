/**
 * Tests for Persona Dashboard Interaction Handlers
 * Tests select menu, button, and modal submission handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  handleModalSubmit,
  handleSelectMenu,
  handleButton,
  isPersonaDashboardInteraction,
} from './dashboard.js';
import { handleDashboardClose } from '../../utils/dashboard/closeHandler.js';
import { buildDeleteConfirmation } from '../../utils/dashboard/deleteConfirmation.js';
import { DASHBOARD_MESSAGES, formatSessionExpiredMessage } from '../../utils/dashboard/messages.js';
import { mockGetPersonaResponse, mockListPersonasResponse } from '@tzurot/test-factories';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

// Valid UUIDs for tests
const TEST_PERSONA_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

// Mock dashboard utilities
const mockBuildDashboardEmbed = vi.fn();
const mockBuildDashboardComponents = vi.fn();
const mockBuildSectionModal = vi.fn();
const mockExtractModalValues = vi.fn();
const mockSessionGet = vi.fn();
const mockSessionSet = vi.fn();
const mockSessionUpdate = vi.fn();
const mockSessionDelete = vi.fn();

// Mock getSessionOrExpired to delegate to mockSessionGet
const mockGetSessionOrExpired = vi
  .fn()
  .mockImplementation(async (interaction, entityType, entityId, _command) => {
    const session = await mockSessionGet(interaction.user.id, entityType, entityId);
    if (session === null) {
      await interaction.editReply({
        content: formatSessionExpiredMessage('/persona browse'),
        embeds: [],
        components: [],
      });
    }
    return session;
  });

// Mock requireDeferredSession: deferUpdate + getSessionOrExpired
const mockRequireDeferredSession = vi
  .fn()
  .mockImplementation(async (interaction, entityType, entityId, command) => {
    await interaction.deferUpdate();
    return mockGetSessionOrExpired(interaction, entityType, entityId, command);
  });

// renderTerminalScreen, renderPostActionScreen, and handleSharedBackButton
// are all exported from the dashboard barrel. They also import from other
// dashboard source modules directly (SessionManager.js, terminalScreen.js)
// which would bypass the barrel mock, so each one is stubbed at its source
// module below. Assertions target the post-action screen (success + error
// paths) and the shared back-button handler for routing.
const mockRenderTerminalScreen = vi.fn();
const mockRenderPostActionScreen = vi.fn();
const mockHandleSharedBackButton = vi.fn();

// Mock getSessionDataOrFollowUp to delegate to mockSessionGet
// Models getSessionDataOrFollowUp (the deferred variant handleDeleteButton now
// uses): followUp on expiry, since the caller has already deferred.
const mockGetSessionDataOrFollowUp = vi
  .fn()
  .mockImplementation(async (interaction, entityType, entityId) => {
    const session = await mockSessionGet(interaction.user.id, entityType, entityId);
    if (session === null) {
      await interaction.followUp({
        content: DASHBOARD_MESSAGES.SESSION_EXPIRED,
        flags: MessageFlags.Ephemeral,
      });
      return null;
    }
    return session.data;
  });

vi.mock('../../utils/dashboard/SessionManager.js', () => ({
  getSessionManager: () => ({
    get: mockSessionGet,
    set: mockSessionSet,
    update: mockSessionUpdate,
    delete: mockSessionDelete,
  }),
  initSessionManager: vi.fn(),
  shutdownSessionManager: vi.fn(),
}));

vi.mock('../../utils/dashboard/terminalScreen.js', () => ({
  renderTerminalScreen: (...args: unknown[]) => mockRenderTerminalScreen(...args),
}));

vi.mock('../../utils/dashboard/postActionScreen.js', () => ({
  renderPostActionScreen: (...args: unknown[]) => mockRenderPostActionScreen(...args),
}));

vi.mock('../../utils/dashboard/sharedBackButtonHandler.js', () => ({
  handleSharedBackButton: (...args: unknown[]) => mockHandleSharedBackButton(...args),
}));

// Intercept the browse.ts side-effect import (which calls
// registerBrowseRebuilder at module load). The test doesn't exercise the
// rebuilder path; a no-op module keeps the import graph valid.
vi.mock('./browse.js', () => ({}));

vi.mock('../../utils/dashboard/index.js', async () => {
  const actual = await vi.importActual('../../utils/dashboard/index.js');
  return {
    ...actual,
    buildDashboardEmbed: (...args: unknown[]) => mockBuildDashboardEmbed(...args),
    buildDashboardComponents: (...args: unknown[]) => mockBuildDashboardComponents(...args),
    buildSectionModal: (...args: unknown[]) => mockBuildSectionModal(...args),
    extractModalValues: (...args: unknown[]) => mockExtractModalValues(...args),
    renderTerminalScreen: (...args: unknown[]) => mockRenderTerminalScreen(...args),
    getSessionManager: () => ({
      get: mockSessionGet,
      set: mockSessionSet,
      update: mockSessionUpdate,
      delete: mockSessionDelete,
    }),
    fetchOrCreateSession: vi
      .fn()
      .mockImplementation(
        async (opts: {
          userId: string;
          entityType: string;
          entityId: string;
          fetchFn: () => Promise<unknown>;
          transformFn: (d: unknown) => unknown;
        }) => {
          const session = await mockSessionGet(opts.userId, opts.entityType, opts.entityId);
          if (session !== null) {
            return { success: true, data: session.data, fromCache: true };
          }
          const raw = await opts.fetchFn();
          if (raw === null) {
            return { success: false, error: 'not_found' };
          }
          const data = opts.transformFn(raw);
          await mockSessionSet({
            userId: opts.userId,
            entityType: opts.entityType,
            entityId: opts.entityId,
            data,
            messageId: 'message-123',
            channelId: 'channel-123',
          });
          return { success: true, data, fromCache: false };
        }
      ),
    extractAndMergeSectionValues: vi
      .fn()
      .mockImplementation(
        (
          _interaction: unknown,
          config: { sections: Array<{ id: string }> },
          sectionId: string,
          currentData: Record<string, unknown>
        ) => {
          const section = config.sections.find((s: { id: string }) => s.id === sectionId);
          if (!section) return null;
          const values = mockExtractModalValues();
          return { section, merged: { ...currentData, ...values } };
        }
      ),
    requireDeferredSession: (...args: unknown[]) => mockRequireDeferredSession(...args),
    getSessionOrExpired: (...args: unknown[]) => mockGetSessionOrExpired(...args),
    getSessionDataOrFollowUp: (...args: unknown[]) => mockGetSessionDataOrFollowUp(...args),
    parseDashboardCustomId: vi.fn((customId: string) => {
      // Simple parser for tests
      const parts = customId.split('::');
      if (parts[0] !== 'persona') return null;
      return {
        entityType: 'persona',
        action: parts[1],
        entityId: parts[2],
        sectionId: parts[3],
      };
    }),
    isDashboardInteraction: vi.fn((customId: string, entityType: string) => {
      return customId.startsWith(`${entityType}::`);
    }),
  };
});

// The generic select menu handler imports these from source modules directly,
// so mocks on the barrel file don't apply. Mirror the barrel mocks here.
vi.mock('../../utils/dashboard/sessionHelpers.js', () => ({
  fetchOrCreateSession: vi
    .fn()
    .mockImplementation(
      async (opts: {
        userId: string;
        entityType: string;
        entityId: string;
        fetchFn: () => Promise<unknown>;
        transformFn: (d: unknown) => unknown;
      }) => {
        const session = await mockSessionGet(opts.userId, opts.entityType, opts.entityId);
        if (session !== null) {
          return { success: true, data: session.data, fromCache: true };
        }
        const raw = await opts.fetchFn();
        if (raw === null) {
          return { success: false, error: 'not_found' };
        }
        const data = opts.transformFn(raw);
        await mockSessionSet({
          userId: opts.userId,
          entityType: opts.entityType,
          entityId: opts.entityId,
          data,
          messageId: 'message-123',
          channelId: 'channel-123',
        });
        return { success: true, data, fromCache: false };
      }
    ),
}));

vi.mock('../../utils/dashboard/ModalFactory.js', () => ({
  buildSectionModal: (...args: unknown[]) => mockBuildSectionModal(...args),
}));

vi.mock('../../utils/dashboard/types.js', async () => {
  const actual = await vi.importActual('../../utils/dashboard/types.js');
  return {
    ...actual,
    parseDashboardCustomId: vi.fn((customId: string) => {
      const parts = customId.split('::');
      if (parts[0] !== 'persona') return null;
      return {
        entityType: 'persona',
        action: parts[1],
        entityId: parts[2],
        sectionId: parts[3],
      };
    }),
  };
});

vi.mock('../../utils/dashboard/closeHandler.js', () => ({
  handleDashboardClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/dashboard/deleteConfirmation.js', () => ({
  buildDeleteConfirmation: vi.fn().mockReturnValue({
    embed: { data: {} },
    components: [],
  }),
}));

const mockRefreshDashboardUI = vi
  .fn()
  .mockImplementation(
    async (options: { interaction: { editReply: (data: unknown) => Promise<void> } }) => {
      const embed = mockBuildDashboardEmbed();
      const components = mockBuildDashboardComponents();
      await options.interaction.editReply({ embeds: [embed], components });
    }
  );
vi.mock('../../utils/dashboard/refreshHandler.js', () => ({
  createRefreshHandler: vi.fn().mockReturnValue(vi.fn().mockResolvedValue(undefined)),
  refreshDashboardUI: (...args: unknown[]) => mockRefreshDashboardUI(...args),
}));

// Shared mock logger reference so tests can assert against `mockLogger.warn`
// (the dispatch helper logs unknown-action violations there). vi.hoisted
// is required because vi.mock factories are hoisted above const declarations.
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('@tzurot/common-types/constants/discord', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/discord')>(
    '@tzurot/common-types/constants/discord'
  );
  return {
    ...actual,
    DISCORD_COLORS: {
      BLURPLE: 0x5865f2,
      WARNING: 0xfee75c,
      // Truncation gate's "Ready to edit" embed uses SUCCESS — required
      // by buildReadyToEditEmbed (utils/dashboard/truncationGate/embeds.ts).
      SUCCESS: 0x00ff00,
    },
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

interface PersonaClientStub {
  listPersonas: ReturnType<typeof vi.fn>;
  getPersona: ReturnType<typeof vi.fn>;
  updatePersona: ReturnType<typeof vi.fn>;
  deletePersona: ReturnType<typeof vi.fn>;
}

function makeStub(): PersonaClientStub {
  return {
    listPersonas: vi.fn(),
    getPersona: vi.fn(),
    updatePersona: vi.fn(),
    deletePersona: vi.fn(),
  };
}

describe('handleModalSubmit', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();
  const mockFollowUp = vi.fn();
  const mockReply = vi.fn();
  let stub: PersonaClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    mockDeferUpdate.mockResolvedValue(undefined);
    mockBuildDashboardEmbed.mockReturnValue({ title: 'Test' });
    mockBuildDashboardComponents.mockReturnValue([]);
  });

  function createMockModalInteraction(customId: string, fields: Record<string, string> = {}) {
    return {
      customId,
      user: { id: '123456789', username: 'testuser' },
      fields: {
        getTextInputValue: (name: string) => fields[name] ?? '',
      },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
      followUp: mockFollowUp,
      reply: mockReply,
    } as unknown as Parameters<typeof handleModalSubmit>[0];
  }

  it('should update persona section when modal submitted', async () => {
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona', preferredName: 'Tester' },
    });
    mockExtractModalValues.mockReturnValue({ name: 'Updated Name' });
    stub.updatePersona.mockResolvedValue(
      makeOk(
        mockGetPersonaResponse({
          persona: { id: TEST_PERSONA_ID, name: 'Updated Name' },
        })
      )
    );

    await handleModalSubmit(
      createMockModalInteraction(`persona::modal::${TEST_PERSONA_ID}::identity`, {
        name: 'Updated Name',
      })
    );

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(stub.updatePersona).toHaveBeenCalledWith(TEST_PERSONA_ID, expect.any(Object));
  });

  it('surfaces the real gateway error message when the update fails', async () => {
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona', preferredName: 'Tester' },
    });
    mockExtractModalValues.mockReturnValue({ name: 'Updated Name' });
    // updatePersona throws GatewayApiError; the dashboard surfaces the
    // extracted gateway message instead of a generic "Please try again".
    stub.updatePersona.mockResolvedValue(makeErr(400, 'pronouns: too long'));

    await handleModalSubmit(
      createMockModalInteraction(`persona::modal::${TEST_PERSONA_ID}::identity`, {
        name: 'Updated Name',
      })
    );

    expect(mockFollowUp).toHaveBeenCalledWith({
      content: '❌ pronouns: too long',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle unknown modal submissions', async () => {
    await handleModalSubmit(createMockModalInteraction('persona::unknown::action'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Unknown form'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should preserve browseContext in session when editing persona from browse', async () => {
    const browseContext = { source: 'browse' as const, page: 2, filter: 'all', sort: 'name' };
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona', preferredName: 'Tester', browseContext },
    });
    mockExtractModalValues.mockReturnValue({ name: 'Updated Name' });
    stub.updatePersona.mockResolvedValue(
      makeOk(
        mockGetPersonaResponse({
          persona: { id: TEST_PERSONA_ID, name: 'Updated Name' },
        })
      )
    );

    await handleModalSubmit(
      createMockModalInteraction(`persona::modal::${TEST_PERSONA_ID}::identity`, {
        name: 'Updated Name',
      })
    );

    // Verify session was updated with browseContext preserved
    expect(mockSessionUpdate).toHaveBeenCalledWith(
      '123456789', // userId
      'persona',
      TEST_PERSONA_ID,
      expect.objectContaining({
        browseContext, // browseContext should be preserved
      })
    );
  });
});

describe('handleSelectMenu', () => {
  const mockShowModal = vi.fn();
  const mockReply = vi.fn();
  let stub: PersonaClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    mockShowModal.mockResolvedValue(undefined);
    mockBuildSectionModal.mockReturnValue({ title: 'Edit Section' });
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona' },
    });
  });

  function createMockSelectInteraction(customId: string, value: string) {
    return {
      customId,
      values: [value],
      user: { id: '123456789', username: 'testuser' },
      message: { id: 'message-123' },
      channelId: 'channel-123',
      showModal: mockShowModal,
      reply: mockReply,
    } as unknown as Parameters<typeof handleSelectMenu>[0];
  }

  it('should show edit modal when section selected', async () => {
    await handleSelectMenu(
      createMockSelectInteraction(`persona::menu::${TEST_PERSONA_ID}`, 'edit-identity')
    );

    expect(mockShowModal).toHaveBeenCalled();
  });

  it('should show error for unknown section', async () => {
    await handleSelectMenu(
      createMockSelectInteraction(`persona::menu::${TEST_PERSONA_ID}`, 'edit-nonexistent')
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Unknown section'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should not open modal or warning when section is unknown', async () => {
    // Pins the early-return contract on `if (ctx === null) { return; }`
    // — when resolvePersonaSectionContext returns null, no downstream
    // side effects should fire (no modal, no warning embed). The
    // sectionContext error reply is the only side effect; the rest of
    // the function must short-circuit cleanly.
    await handleSelectMenu(
      createMockSelectInteraction(`persona::menu::${TEST_PERSONA_ID}`, 'edit-nonexistent')
    );

    expect(mockShowModal).not.toHaveBeenCalled();
    // mockReply is the sectionContext error path; verify it received
    // ONLY the unknown-section content (not the warning embed shape).
    const replyCall = mockReply.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(replyCall?.embeds).toBeUndefined();
    expect(replyCall?.components).toBeUndefined();
  });

  it('should ignore non-persona interactions', async () => {
    await handleSelectMenu(
      createMockSelectInteraction(
        'character::menu::b2c3d4e5-f6a7-8901-bcde-f12345678901',
        'edit-identity'
      )
    );

    expect(mockShowModal).not.toHaveBeenCalled();
  });

  it('should show truncation warning when content exceeds maxLength', async () => {
    // Populate session data with `content` past the 4000-char modal cap.
    // The new flow detects over-length fields and replies with the
    // ephemeral warning embed instead of opening the modal directly.
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona', content: 'x'.repeat(4500) },
    });

    await handleSelectMenu(
      createMockSelectInteraction(`persona::menu::${TEST_PERSONA_ID}`, 'edit-identity')
    );

    expect(mockShowModal).not.toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        embeds: expect.any(Array),
        components: expect.any(Array),
      })
    );
  });

  it('should catch 10062 on showModal and surface a retry followUp', async () => {
    // Mirrors handleOpenEditorButton's 10062 catch — same residual risk
    // (Redis/gateway slow, can't deferReply before showModal). Without
    // this catch, the user sees a silent "Interaction Failed" with no
    // diagnostic signal in logs.
    const { DiscordAPIError } = await import('discord.js');
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona', content: 'fits' },
    });
    const timeoutError = new DiscordAPIError(
      { code: 10062, message: 'Unknown interaction' },
      10062,
      404,
      'POST',
      '/interactions/x/y/callback',
      {}
    );
    const failingShowModal = vi.fn().mockRejectedValue(timeoutError);
    const followUpSpy = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      customId: `persona::menu::${TEST_PERSONA_ID}`,
      values: ['edit-identity'],
      user: { id: '123456789', username: 'testuser' },
      message: { id: 'message-123' },
      channelId: 'channel-123',
      showModal: failingShowModal,
      followUp: followUpSpy,
      reply: vi.fn(),
    } as unknown as Parameters<typeof handleSelectMenu>[0];

    await handleSelectMenu(interaction);

    expect(failingShowModal).toHaveBeenCalled();
    expect(followUpSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Took too long'),
        flags: MessageFlags.Ephemeral,
      })
    );
  });

  it('should open modal directly when no fields over limit', async () => {
    // Re-establishes the common path after the truncation-warning addition:
    // when content fits, the gate is transparent and the modal opens.
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona', content: 'fits within cap' },
    });

    await handleSelectMenu(
      createMockSelectInteraction(`persona::menu::${TEST_PERSONA_ID}`, 'edit-identity')
    );

    expect(mockShowModal).toHaveBeenCalled();
  });
});

describe('handleButton', () => {
  const mockUpdate = vi.fn();
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();
  const mockReply = vi.fn();
  const mockFollowUp = vi.fn();
  let stub: PersonaClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    mockUpdate.mockResolvedValue(undefined);
    mockDeferUpdate.mockResolvedValue(undefined);
    mockBuildDashboardEmbed.mockReturnValue({ title: 'Test' });
    mockBuildDashboardComponents.mockReturnValue([]);
    // Reset session helper mocks to default implementations
    mockGetSessionOrExpired.mockImplementation(async (interaction, entityType, entityId) => {
      const session = await mockSessionGet(interaction.user.id, entityType, entityId);
      if (session === null) {
        await interaction.editReply({
          content: formatSessionExpiredMessage('/persona browse'),
          embeds: [],
          components: [],
        });
      }
      return session;
    });
    // Models getSessionDataOrFollowUp (handleDeleteButton defers first, so the
    // helper followUps on expiry — reply would throw on the acked interaction).
    mockGetSessionDataOrFollowUp.mockImplementation(async (interaction, entityType, entityId) => {
      const session = await mockSessionGet(interaction.user.id, entityType, entityId);
      if (session === null) {
        await interaction.followUp({
          content: DASHBOARD_MESSAGES.SESSION_EXPIRED,
          flags: MessageFlags.Ephemeral,
        });
        return null;
      }
      return session.data;
    });
  });

  function createMockButtonInteraction(customId: string) {
    return {
      customId,
      user: { id: '123456789', username: 'testuser' },
      message: { id: 'message-123' },
      channelId: 'channel-123',
      update: mockUpdate,
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
      reply: mockReply,
      followUp: mockFollowUp,
    } as unknown as Parameters<typeof handleButton>[0];
  }

  it('should delegate to shared close handler on close button', async () => {
    const mockInteraction = createMockButtonInteraction(`persona::close::${TEST_PERSONA_ID}`);
    await handleButton(mockInteraction);

    // Verify delegation to shared handler
    expect(handleDashboardClose).toHaveBeenCalledWith(
      expect.anything(),
      'persona',
      TEST_PERSONA_ID
    );
  });

  it('should show confirmation using shared delete confirmation builder', async () => {
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona', isDefault: false },
    });
    // isDefaultPersona calls listPersonas to check if persona is default
    stub.listPersonas.mockResolvedValue(
      makeOk(
        mockListPersonasResponse([{ id: TEST_PERSONA_ID, name: 'Test Persona', isDefault: false }])
      )
    );

    await handleButton(createMockButtonInteraction(`persona::delete::${TEST_PERSONA_ID}`));

    // Verify the shared delete confirmation builder was called
    expect(buildDeleteConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Persona',
        entityName: 'Test Persona',
      })
    );
    // Ack-first: the confirm dialog now renders via editReply (post-deferUpdate).
    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalled();
  });

  it('should block delete of default persona', async () => {
    mockSessionGet.mockResolvedValue({
      data: { name: 'Default Persona', isDefault: true },
    });
    // isDefaultPersona returns true via listPersonas
    stub.listPersonas.mockResolvedValue(
      makeOk(
        mockListPersonasResponse([
          { id: TEST_PERSONA_ID, name: 'Default Persona', isDefault: true },
        ])
      )
    );

    await handleButton(createMockButtonInteraction(`persona::delete::${TEST_PERSONA_ID}`));

    // Ack-first: deferUpdate runs before the gateway isDefaultPersona() check; the
    // block notice is a followUp (reply would throw post-defer), and no confirm
    // dialog is rendered.
    expect(mockFollowUp).toHaveBeenCalledWith({
      content: expect.stringContaining('Cannot delete your default'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockEditReply).not.toHaveBeenCalled();
  });

  it('should show error on delete when session expired', async () => {
    mockSessionGet.mockResolvedValue(null);

    await handleButton(createMockButtonInteraction(`persona::delete::${TEST_PERSONA_ID}`));

    // Ack-first: deferUpdate, then the deferred session helper followUps on expiry.
    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockFollowUp).toHaveBeenCalledWith({
      content: expect.stringContaining('Session expired'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should route confirm-delete success through renderPostActionScreen', async () => {
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona' },
    });
    stub.deletePersona.mockResolvedValue(makeOk({ message: 'Deleted' }));

    await handleButton(createMockButtonInteraction(`persona::confirm-delete::${TEST_PERSONA_ID}`));

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(stub.deletePersona).toHaveBeenCalledWith(TEST_PERSONA_ID);
    // Success routes through renderPostActionScreen with a formatted banner.
    // The helper decides success-with-rebuild vs clean-terminal based on
    // the session's browseContext; tested independently.
    expect(mockRenderPostActionScreen).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          entityType: 'persona',
          entityId: TEST_PERSONA_ID,
        }),
        outcome: expect.objectContaining({
          kind: 'success',
          banner: expect.stringContaining('Test Persona'),
        }),
      })
    );
  });

  it('should carry browseContext from session into the post-action screen on confirm-delete', async () => {
    const browseContext = { source: 'browse', page: 1, filter: 'all', sort: 'name' };
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona', browseContext },
    });
    stub.deletePersona.mockResolvedValue(makeOk({ message: 'Deleted' }));

    await handleButton(createMockButtonInteraction(`persona::confirm-delete::${TEST_PERSONA_ID}`));

    expect(mockRenderPostActionScreen).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ browseContext }),
      })
    );
  });

  it('should route confirm-delete failure through renderPostActionScreen as an error outcome', async () => {
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona' },
    });
    stub.deletePersona.mockResolvedValue(makeErr(500, 'Delete failed'));

    await handleButton(createMockButtonInteraction(`persona::confirm-delete::${TEST_PERSONA_ID}`));

    expect(mockRenderPostActionScreen).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: expect.objectContaining({
          kind: 'error',
          content: expect.stringContaining('Failed to delete'),
        }),
      })
    );
  });

  it('should route back button through handleSharedBackButton', async () => {
    await handleButton(createMockButtonInteraction(`persona::back::${TEST_PERSONA_ID}`));

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockHandleSharedBackButton).toHaveBeenCalledWith(
      expect.anything(),
      'persona',
      TEST_PERSONA_ID
    );
  });

  it('should return to dashboard on cancel-delete button', async () => {
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona', isDefault: false },
    });

    await handleButton(createMockButtonInteraction(`persona::cancel-delete::${TEST_PERSONA_ID}`));

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockBuildDashboardEmbed).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalled();
  });

  it('should show error on cancel-delete when session expired', async () => {
    mockSessionGet.mockResolvedValue(null);

    await handleButton(createMockButtonInteraction(`persona::cancel-delete::${TEST_PERSONA_ID}`));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Session expired'),
      embeds: [],
      components: [],
    });
  });

  it('should ignore non-persona button interactions', async () => {
    await handleButton(createMockButtonInteraction('character::close::some-id'));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDeferUpdate).not.toHaveBeenCalled();
  });

  it('should log + drop unknown truncation-gate actions without acking', async () => {
    // Pins the `default:` contract on the dispatch helper. An unknown
    // persona action with the dashboard-prefix shape is parsed through
    // PersonaCustomIds.parse → falls through the main switch into
    // dispatchTruncationGateAction → no case matches → `default` logs
    // the violation so a future drift between DASHBOARD_ACTIONS and the
    // switch cases is diagnosable. The interaction is left unacked
    // (Discord surfaces "Interaction Failed"); the handler doesn't
    // throw, double-reply, or otherwise propagate.
    mockLogger.warn.mockClear();
    await handleButton(
      createMockButtonInteraction(`persona::fake_action::${TEST_PERSONA_ID}::identity`)
    );

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
    // The log assertion is the contract — without it, "logged" in the
    // test name would be a lie (and was, until this assertion existed).
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'fake_action' }),
      expect.stringContaining('Unknown truncation-gate action')
    );
  });

  it('should silently drop sectionId-requiring actions when sectionId is absent', async () => {
    // Mid-customId truncation: e.g. `persona::edit_truncated::personaId`
    // (no fourth segment). The dispatch helper logs + returns; the
    // handleEditTruncatedButton handler is never called.
    await handleButton(createMockButtonInteraction(`persona::edit_truncated::${TEST_PERSONA_ID}`));

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should route cancel_edit button to update with cancellation notice', async () => {
    // The cancel_edit handler is dashboard-state-light: just an update()
    // that clears the warning embed. No session lookup, no API call.
    await handleButton(
      createMockButtonInteraction(`persona::cancel_edit::${TEST_PERSONA_ID}::identity`)
    );

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('cancelled'),
        embeds: [],
        components: [],
      })
    );
  });

  it('should route edit_truncated button to two-click flow update', async () => {
    // Step 1 of the two-click flow: update to "Ready to edit" embed +
    // single Open Editor button. No showModal at this stage.
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona', content: 'x'.repeat(4500) },
    });

    const interaction = createMockButtonInteraction(
      `persona::edit_truncated::${TEST_PERSONA_ID}::identity`
    ) as unknown as Record<string, unknown>;
    interaction.followUp = vi.fn();

    await handleButton(interaction as unknown as Parameters<typeof handleButton>[0]);

    expect(mockUpdate).toHaveBeenCalled();
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.embeds).toHaveLength(1);
    expect(updateArgs.components).toHaveLength(1);
  });

  it('should route open_editor button to showModal', async () => {
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona', content: 'fits' },
    });

    const showModalSpy = vi.fn().mockResolvedValue(undefined);
    const interaction = createMockButtonInteraction(
      `persona::open_editor::${TEST_PERSONA_ID}::identity`
    ) as unknown as Record<string, unknown>;
    interaction.showModal = showModalSpy;

    await handleButton(interaction as unknown as Parameters<typeof handleButton>[0]);

    expect(showModalSpy).toHaveBeenCalled();
  });

  it('should route view_full button to deferReply + editReply with attachment', async () => {
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona', content: 'x'.repeat(4500) },
    });

    // view_full follows the deferReply → resolveContext → editReply path.
    // The deferReply must transition the interaction's `deferred` getter
    // to true so sectionContext's replyError predicate would route via
    // followUp on error (we don't exercise the error path here, but the
    // state transition matters for the success path's editReply).
    const state = { deferred: false, replied: false };
    const deferReplySpy = vi.fn().mockImplementation(async () => {
      state.deferred = true;
    });
    const editReplySpy = vi.fn().mockResolvedValue(undefined);
    const baseInteraction = createMockButtonInteraction(
      `persona::view_full::${TEST_PERSONA_ID}::identity`
    ) as unknown as Record<string, unknown>;
    Object.defineProperty(baseInteraction, 'deferred', {
      get: () => state.deferred,
    });
    Object.defineProperty(baseInteraction, 'replied', {
      get: () => state.replied,
    });
    baseInteraction.deferReply = deferReplySpy;
    baseInteraction.editReply = editReplySpy;

    await handleButton(baseInteraction as unknown as Parameters<typeof handleButton>[0]);

    expect(deferReplySpy).toHaveBeenCalled();
    expect(editReplySpy).toHaveBeenCalled();
    const editArgs = editReplySpy.mock.calls[0][0];
    expect(editArgs.files).toHaveLength(1);
  });
});

describe('isPersonaDashboardInteraction', () => {
  it('should return true for persona dashboard interactions', () => {
    expect(
      isPersonaDashboardInteraction('persona::menu::b2c3d4e5-f6a7-8901-bcde-f12345678901')
    ).toBe(true);
    expect(
      isPersonaDashboardInteraction('persona::close::b2c3d4e5-f6a7-8901-bcde-f12345678901')
    ).toBe(true);
    expect(
      isPersonaDashboardInteraction('persona::modal::b2c3d4e5-f6a7-8901-bcde-f12345678901::section')
    ).toBe(true);
    expect(
      isPersonaDashboardInteraction('persona::refresh::b2c3d4e5-f6a7-8901-bcde-f12345678901')
    ).toBe(true);
    expect(
      isPersonaDashboardInteraction('persona::delete::b2c3d4e5-f6a7-8901-bcde-f12345678901')
    ).toBe(true);
    expect(
      isPersonaDashboardInteraction('persona::confirm-delete::b2c3d4e5-f6a7-8901-bcde-f12345678901')
    ).toBe(true);
    expect(
      isPersonaDashboardInteraction('persona::cancel-delete::b2c3d4e5-f6a7-8901-bcde-f12345678901')
    ).toBe(true);
    expect(
      isPersonaDashboardInteraction('persona::back::b2c3d4e5-f6a7-8901-bcde-f12345678901')
    ).toBe(true);
    // Truncation gate actions.
    expect(
      isPersonaDashboardInteraction(
        'persona::edit_truncated::b2c3d4e5-f6a7-8901-bcde-f12345678901::identity'
      )
    ).toBe(true);
    expect(
      isPersonaDashboardInteraction(
        'persona::open_editor::b2c3d4e5-f6a7-8901-bcde-f12345678901::identity'
      )
    ).toBe(true);
    expect(
      isPersonaDashboardInteraction(
        'persona::view_full::b2c3d4e5-f6a7-8901-bcde-f12345678901::identity'
      )
    ).toBe(true);
    expect(
      isPersonaDashboardInteraction(
        'persona::cancel_edit::b2c3d4e5-f6a7-8901-bcde-f12345678901::identity'
      )
    ).toBe(true);
  });

  it('should return false for non-persona interactions', () => {
    expect(
      isPersonaDashboardInteraction('character::menu::b2c3d4e5-f6a7-8901-bcde-f12345678901')
    ).toBe(false);
    expect(
      isPersonaDashboardInteraction('other::close::b2c3d4e5-f6a7-8901-bcde-f12345678901')
    ).toBe(false);
  });

  it('should return false for non-dashboard persona actions', () => {
    // These should NOT match as dashboard interactions - they're handled separately
    expect(
      isPersonaDashboardInteraction(
        'persona::expand::b2c3d4e5-f6a7-8901-bcde-f12345678901::content'
      )
    ).toBe(false);
    expect(isPersonaDashboardInteraction('persona::browse::0::name')).toBe(false);
    expect(isPersonaDashboardInteraction('persona::browse-select::0::name')).toBe(false);
    expect(isPersonaDashboardInteraction('persona::create')).toBe(false);
    expect(isPersonaDashboardInteraction('persona::override-create::personality-id')).toBe(false);
  });
});
