/**
 * Tests for Persona Browse Handler
 * Tests gateway API calls, pagination, and select menu interactions.
 *
 * Note: Uses deferred interaction context (editReply, not reply).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleBrowse,
  handleBrowsePagination,
  handleBrowseSelect,
  isPersonaBrowseInteraction,
  isPersonaBrowseSelectInteraction,
} from './browse.js';
import { mockListPersonasResponse, mockGetPersonaResponse } from '@tzurot/common-types';

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
const mockSessionSet = vi.fn();
vi.mock('../../utils/dashboard/index.js', () => ({
  buildDashboardEmbed: (...args: unknown[]) => mockBuildDashboardEmbed(...args),
  buildDashboardComponents: (...args: unknown[]) => mockBuildDashboardComponents(...args),
  getSessionManager: () => ({
    set: mockSessionSet,
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
    },
  };
});

describe('handleBrowse', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildDashboardEmbed.mockReturnValue({ title: 'Test' });
    mockBuildDashboardComponents.mockReturnValue([]);
  });

  function createMockContext() {
    return {
      user: { id: '123456789' },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowse>[0];
  }

  it('should display personas in paginated format', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        { name: 'Persona A', isDefault: true, preferredName: 'Alice' },
        { name: 'Persona B', isDefault: false, preferredName: null },
      ]),
    });

    await handleBrowse(createMockContext());

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona', { userId: '123456789' });
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
      components: expect.any(Array),
    });
  });

  it('should show empty state when user has no personas', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([]),
    });

    await handleBrowse(createMockContext());

    expect(mockEditReply).toHaveBeenCalled();
    const call = mockEditReply.mock.calls[0][0];
    expect(call.embeds[0].data.description).toContain("don't have any personas");
  });

  it('should handle gateway errors gracefully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Gateway error',
    });

    await handleBrowse(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to load'),
    });
  });

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleBrowse(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Failed to load'));
  });
});

describe('handleBrowsePagination', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeferUpdate.mockResolvedValue(undefined);
  });

  function createMockButtonInteraction(customId: string) {
    return {
      customId,
      user: { id: '123456789' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowsePagination>[0];
  }

  it('should fetch and display requested page', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        { name: 'Persona A', isDefault: true },
        { name: 'Persona B', isDefault: false },
      ]),
    });

    await handleBrowsePagination(createMockButtonInteraction('persona::browse::1::all::name::'));

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona', { userId: '123456789' });
    expect(mockEditReply).toHaveBeenCalled();
  });

  it('should do nothing for non-browse interactions', async () => {
    await handleBrowsePagination(createMockButtonInteraction('persona::other::action'));

    expect(mockDeferUpdate).not.toHaveBeenCalled();
  });
});

describe('handleBrowseSelect', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeferUpdate.mockResolvedValue(undefined);
    mockBuildDashboardEmbed.mockReturnValue({ title: 'Test' });
    mockBuildDashboardComponents.mockReturnValue([]);
  });

  function createMockSelectInteraction(personaId: string) {
    return {
      customId: 'persona::browse-select::0::all::name::',
      values: [personaId],
      user: { id: '123456789' },
      channelId: 'channel-123',
      message: { id: 'message-123' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowseSelect>[0];
  }

  it('should open dashboard for selected persona', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockGetPersonaResponse({
        persona: {
          id: TEST_PERSONA_ID,
          name: 'Test Persona',
          isDefault: false,
          preferredName: null,
          pronouns: null,
          content: '',
          description: null,
          shareLtmAcrossPersonalities: false,
        },
      }),
    });

    await handleBrowseSelect(createMockSelectInteraction(TEST_PERSONA_ID));

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockCallGatewayApi).toHaveBeenCalledWith(`/user/persona/${TEST_PERSONA_ID}`, {
      userId: '123456789',
    });
    expect(mockBuildDashboardEmbed).toHaveBeenCalled();
    expect(mockSessionSet).toHaveBeenCalled();
  });

  it('should show error when persona not found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Persona not found',
    });

    await handleBrowseSelect(createMockSelectInteraction(TEST_PERSONA_ID));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona not found'),
      embeds: [],
      components: [],
    });
  });
});

describe('isPersonaBrowseInteraction', () => {
  it('should return true for browse button interactions', () => {
    expect(isPersonaBrowseInteraction('persona::browse::0::all::name::')).toBe(true);
    expect(isPersonaBrowseInteraction('persona::browse::1::all::date::')).toBe(true);
  });

  it('should return false for non-browse interactions', () => {
    expect(isPersonaBrowseInteraction('persona::other::action')).toBe(false);
    expect(isPersonaBrowseInteraction('character::browse::0::all::name::')).toBe(false);
  });
});

describe('isPersonaBrowseSelectInteraction', () => {
  it('should return true for browse select interactions', () => {
    expect(isPersonaBrowseSelectInteraction('persona::browse-select::0::all::name::')).toBe(true);
  });

  it('should return false for non-browse-select interactions', () => {
    expect(isPersonaBrowseSelectInteraction('persona::browse::0::all::name::')).toBe(false);
    expect(isPersonaBrowseSelectInteraction('persona::other::action')).toBe(false);
  });
});
