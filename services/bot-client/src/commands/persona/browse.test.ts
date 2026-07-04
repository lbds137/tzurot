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
import { registerBrowseRebuilder } from '../../utils/dashboard/index.js';
import { mockListPersonasResponse, mockGetPersonaResponse } from '@tzurot/test-factories';
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
const mockSessionSet = vi.fn();
vi.mock('../../utils/dashboard/index.js', () => ({
  buildDashboardEmbed: (...args: unknown[]) => mockBuildDashboardEmbed(...args),
  buildDashboardComponents: (...args: unknown[]) => mockBuildDashboardComponents(...args),
  getSessionManager: () => ({
    set: mockSessionSet,
  }),
  registerBrowseRebuilder: vi.fn(),
}));

vi.mock('@tzurot/common-types/constants/discord', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/discord')>(
    '@tzurot/common-types/constants/discord'
  );
  return {
    ...actual,
    DISCORD_COLORS: {
      BLURPLE: 0x5865f2,
    },
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

interface PersonaClientStub {
  listPersonas: ReturnType<typeof vi.fn>;
  getPersona: ReturnType<typeof vi.fn>;
}

function makeStub(): PersonaClientStub {
  return {
    listPersonas: vi.fn(),
    getPersona: vi.fn(),
  };
}

describe('handleBrowse', () => {
  const mockEditReply = vi.fn();
  let stub: PersonaClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    mockBuildDashboardEmbed.mockReturnValue({ title: 'Test' });
    mockBuildDashboardComponents.mockReturnValue([]);
  });

  function createMockContext() {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: { user: { id: '123456789', username: 'testuser' } },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowse>[0];
  }

  it('should display personas in paginated format', async () => {
    stub.listPersonas.mockResolvedValue(
      makeOk(
        mockListPersonasResponse([
          { name: 'Persona A', isDefault: true, preferredName: 'Alice' },
          { name: 'Persona B', isDefault: false, preferredName: null },
        ])
      )
    );

    await handleBrowse(createMockContext());

    expect(stub.listPersonas).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
      components: expect.any(Array),
    });
  });

  it('should show empty state when user has no personas', async () => {
    stub.listPersonas.mockResolvedValue(makeOk(mockListPersonasResponse([])));

    await handleBrowse(createMockContext());

    expect(mockEditReply).toHaveBeenCalled();
    const call = mockEditReply.mock.calls[0][0];
    expect(call.embeds[0].data.description).toContain("don't have any personas");
  });

  it('should handle gateway errors gracefully', async () => {
    stub.listPersonas.mockResolvedValue(makeErr(500, 'Gateway error'));

    await handleBrowse(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to load'),
    });
  });

  it('should handle network errors gracefully', async () => {
    stub.listPersonas.mockRejectedValue(new Error('Network error'));

    await handleBrowse(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Failed to load'));
  });
});

describe('handleBrowsePagination', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();
  let stub: PersonaClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    mockDeferUpdate.mockResolvedValue(undefined);
  });

  function createMockButtonInteraction(customId: string) {
    return {
      customId,
      user: { id: '123456789', username: 'testuser' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowsePagination>[0];
  }

  it('should fetch and display requested page', async () => {
    stub.listPersonas.mockResolvedValue(
      makeOk(
        mockListPersonasResponse([
          { name: 'Persona A', isDefault: true },
          { name: 'Persona B', isDefault: false },
        ])
      )
    );

    await handleBrowsePagination(createMockButtonInteraction('persona::browse::1::all::name::'));

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(stub.listPersonas).toHaveBeenCalled();
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
  let stub: PersonaClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    mockDeferUpdate.mockResolvedValue(undefined);
    mockBuildDashboardEmbed.mockReturnValue({ title: 'Test' });
    mockBuildDashboardComponents.mockReturnValue([]);
  });

  function createMockSelectInteraction(personaId: string) {
    return {
      customId: 'persona::browse-select::0::all::name::',
      values: [personaId],
      user: { id: '123456789', username: 'testuser' },
      channelId: 'channel-123',
      message: { id: 'message-123' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleBrowseSelect>[0];
  }

  it('should open dashboard for selected persona', async () => {
    stub.getPersona.mockResolvedValue(
      makeOk(
        mockGetPersonaResponse({
          persona: {
            id: TEST_PERSONA_ID,
            name: 'Test Persona',
            isDefault: false,
            preferredName: null,
            pronouns: null,
            content: '',
            description: null,
          },
        })
      )
    );

    await handleBrowseSelect(createMockSelectInteraction(TEST_PERSONA_ID));

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(stub.getPersona).toHaveBeenCalledWith(TEST_PERSONA_ID);
    expect(mockBuildDashboardEmbed).toHaveBeenCalled();
    expect(mockSessionSet).toHaveBeenCalled();
  });

  it('should show error when persona not found', async () => {
    stub.getPersona.mockResolvedValue(makeErr(404, 'Persona not found'));

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

// Capture the rebuilder callback registered at module-load BEFORE any
// `vi.clearAllMocks()` in sibling describes wipes the call history. This
// reference is what the adapter-body tests invoke directly (codecov/patch
// coverage).
const personaRebuilderCall = vi
  .mocked(registerBrowseRebuilder)
  .mock.calls.find(c => c[0] === 'persona');
if (personaRebuilderCall === undefined) {
  throw new Error('persona rebuilder was not registered at module load');
}
const personaRebuilder = personaRebuilderCall[1];

describe('registered browse rebuilder', () => {
  let stub: PersonaClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockInteraction() {
    return { user: { id: '123456789', username: 'testuser' } } as unknown as Parameters<
      typeof personaRebuilder
    >[0];
  }

  it('returns rebuilt view with banner on success', async () => {
    stub.listPersonas.mockResolvedValueOnce(
      makeOk(mockListPersonasResponse([{ name: 'Persona A', isDefault: true }]))
    );

    const result = await personaRebuilder(
      createMockInteraction(),
      { source: 'browse', page: 0, filter: 'all', sort: 'name' },
      '✅ Banner'
    );

    expect(result).not.toBeNull();
    expect(result).toEqual({
      content: '✅ Banner',
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('returns null when gateway fetch fails', async () => {
    stub.listPersonas.mockResolvedValueOnce(makeErr(500, 'Network'));

    const result = await personaRebuilder(
      createMockInteraction(),
      { source: 'browse', page: 0, filter: 'all', sort: 'name' },
      '✅ Banner'
    );

    expect(result).toBeNull();
  });
});
