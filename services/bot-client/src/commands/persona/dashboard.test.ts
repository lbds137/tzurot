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
import { mockGetPersonaResponse, mockListPersonasResponse } from '@tzurot/common-types';

// Valid UUIDs for tests
const TEST_PERSONA_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
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
vi.mock('../../utils/dashboard/index.js', () => ({
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

  it('should close dashboard and clean up session on close button', async () => {
    await handleButton(
      createMockButtonInteraction('persona::close::a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    );

    expect(mockSessionDelete).toHaveBeenCalledWith(
      '123456789',
      'persona',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    );
    expect(mockUpdate).toHaveBeenCalledWith({
      content: expect.stringContaining('Dashboard closed'),
      embeds: [],
      components: [],
    });
  });

  it('should refresh dashboard with fresh data on refresh button', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockGetPersonaResponse({
        persona: {
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          name: 'Test Persona',
          isDefault: false,
        },
      }),
    });

    await handleButton(
      createMockButtonInteraction('persona::refresh::a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    );

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/persona/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      {
        userId: '123456789',
      }
    );
    expect(mockBuildDashboardEmbed).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalled();
  });

  it('should show confirmation on delete button', async () => {
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

    expect(mockUpdate).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({ title: expect.stringContaining('Delete') }),
        }),
      ],
      components: expect.any(Array),
    });
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
  });

  it('should return false for non-persona interactions', () => {
    expect(
      isPersonaDashboardInteraction('character::menu::b2c3d4e5-f6a7-8901-bcde-f12345678901')
    ).toBe(false);
    expect(
      isPersonaDashboardInteraction('other::close::b2c3d4e5-f6a7-8901-bcde-f12345678901')
    ).toBe(false);
  });
});
