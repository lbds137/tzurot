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
import { mockGetPersonaResponse, mockListPersonasResponse } from '@tzurot/common-types';

// Valid UUIDs for tests
const TEST_PERSONA_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  GATEWAY_TIMEOUTS: { AUTOCOMPLETE: 2500, DEFERRED: 10000 },
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
        content: 'Session expired. Please run /persona browse to try again.',
        embeds: [],
        components: [],
      });
    }
    return session;
  });

// Mock getSessionDataOrReply to delegate to mockSessionGet
const mockGetSessionDataOrReply = vi
  .fn()
  .mockImplementation(async (interaction, entityType, entityId) => {
    const session = await mockSessionGet(interaction.user.id, entityType, entityId);
    if (session === null) {
      await interaction.reply({
        content: 'Session expired. Please try again.',
        flags: 64,
      });
      return null;
    }
    return session.data;
  });

vi.mock('../../utils/dashboard/index.js', async () => {
  const actual = await vi.importActual('../../utils/dashboard/index.js');
  return {
    ...actual,
    buildDashboardEmbed: (...args: unknown[]) => mockBuildDashboardEmbed(...args),
    buildDashboardComponents: (...args: unknown[]) => mockBuildDashboardComponents(...args),
    buildSectionModal: (...args: unknown[]) => mockBuildSectionModal(...args),
    extractModalValues: (...args: unknown[]) => mockExtractModalValues(...args),
    getSessionManager: () => ({
      get: mockSessionGet,
      set: mockSessionSet,
      update: mockSessionUpdate,
      delete: mockSessionDelete,
    }),
    getSessionOrExpired: (...args: unknown[]) => mockGetSessionOrExpired(...args),
    getSessionDataOrReply: (...args: unknown[]) => mockGetSessionDataOrReply(...args),
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

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    DISCORD_COLORS: {
      BLURPLE: 0x5865f2,
      WARNING: 0xfee75c,
    },
  };
});

describe('handleModalSubmit', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();
  const mockFollowUp = vi.fn();
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeferUpdate.mockResolvedValue(undefined);
    mockBuildDashboardEmbed.mockReturnValue({ title: 'Test' });
    mockBuildDashboardComponents.mockReturnValue([]);
  });

  function createMockModalInteraction(customId: string, fields: Record<string, string> = {}) {
    return {
      customId,
      user: { id: '123456789' },
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
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockGetPersonaResponse({
        persona: { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Updated Name' },
      }),
    });

    await handleModalSubmit(
      createMockModalInteraction('persona::modal::a1b2c3d4-e5f6-7890-abcd-ef1234567890::identity', {
        name: 'Updated Name',
      })
    );

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      `/user/persona/${TEST_PERSONA_ID}`,
      expect.objectContaining({
        method: 'PUT',
        userId: '123456789',
      })
    );
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
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockGetPersonaResponse({
        persona: { id: TEST_PERSONA_ID, name: 'Updated Name' },
      }),
    });

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

  beforeEach(() => {
    vi.clearAllMocks();
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
      user: { id: '123456789' },
      message: { id: 'message-123' },
      channelId: 'channel-123',
      showModal: mockShowModal,
      reply: mockReply,
    } as unknown as Parameters<typeof handleSelectMenu>[0];
  }

  it('should show edit modal when section selected', async () => {
    await handleSelectMenu(
      createMockSelectInteraction(
        'persona::menu::a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'edit-identity'
      )
    );

    expect(mockShowModal).toHaveBeenCalled();
  });

  it('should show error for unknown section', async () => {
    await handleSelectMenu(
      createMockSelectInteraction(
        'persona::menu::a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'edit-nonexistent'
      )
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Unknown section'),
      flags: MessageFlags.Ephemeral,
    });
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
});

describe('handleButton', () => {
  const mockUpdate = vi.fn();
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue(undefined);
    mockDeferUpdate.mockResolvedValue(undefined);
    mockBuildDashboardEmbed.mockReturnValue({ title: 'Test' });
    mockBuildDashboardComponents.mockReturnValue([]);
    // Reset session helper mocks to default implementations
    mockGetSessionOrExpired.mockImplementation(async (interaction, entityType, entityId) => {
      const session = await mockSessionGet(interaction.user.id, entityType, entityId);
      if (session === null) {
        await interaction.editReply({
          content: 'Session expired. Please run /persona browse to try again.',
          embeds: [],
          components: [],
        });
      }
      return session;
    });
    mockGetSessionDataOrReply.mockImplementation(async (interaction, entityType, entityId) => {
      const session = await mockSessionGet(interaction.user.id, entityType, entityId);
      if (session === null) {
        await interaction.reply({
          content: 'Session expired. Please try again.',
          flags: 64,
        });
        return null;
      }
      return session.data;
    });
  });

  function createMockButtonInteraction(customId: string) {
    return {
      customId,
      user: { id: '123456789' },
      message: { id: 'message-123' },
      channelId: 'channel-123',
      update: mockUpdate,
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
      reply: mockReply,
    } as unknown as Parameters<typeof handleButton>[0];
  }

  it('should delegate to shared close handler on close button', async () => {
    const mockInteraction = createMockButtonInteraction(
      'persona::close::a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    );
    await handleButton(mockInteraction);

    // Verify delegation to shared handler
    expect(handleDashboardClose).toHaveBeenCalledWith(
      expect.anything(),
      'persona',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    );
  });

  it('should show confirmation using shared delete confirmation builder', async () => {
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona', isDefault: false },
    });
    // isDefaultPersona calls /user/persona to check if persona is default
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        { id: TEST_PERSONA_ID, name: 'Test Persona', isDefault: false },
      ]),
    });

    await handleButton(createMockButtonInteraction(`persona::delete::${TEST_PERSONA_ID}`));

    // Verify the shared delete confirmation builder was called
    expect(buildDeleteConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Persona',
        entityName: 'Test Persona',
      })
    );
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('should block delete of default persona', async () => {
    mockSessionGet.mockResolvedValue({
      data: { name: 'Default Persona', isDefault: true },
    });
    // isDefaultPersona returns true
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        { id: TEST_PERSONA_ID, name: 'Default Persona', isDefault: true },
      ]),
    });

    await handleButton(createMockButtonInteraction(`persona::delete::${TEST_PERSONA_ID}`));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Cannot delete your default'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should show error on delete when session expired', async () => {
    mockSessionGet.mockResolvedValue(null);

    await handleButton(createMockButtonInteraction(`persona::delete::${TEST_PERSONA_ID}`));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Session expired'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should delete persona on confirm-delete button', async () => {
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona' },
    });
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { message: 'Deleted' },
    });

    await handleButton(createMockButtonInteraction(`persona::confirm-delete::${TEST_PERSONA_ID}`));

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      `/user/persona/${TEST_PERSONA_ID}`,
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(mockSessionDelete).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('has been deleted'),
      embeds: [],
      components: [],
    });
  });

  it('should show error on confirm-delete when delete fails', async () => {
    mockSessionGet.mockResolvedValue({
      data: { name: 'Test Persona' },
    });
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Delete failed',
    });

    await handleButton(createMockButtonInteraction(`persona::confirm-delete::${TEST_PERSONA_ID}`));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to delete'),
      embeds: [],
      components: [],
    });
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
