/**
 * Tests for Persona Edit Handler
 * Tests gateway API calls and dashboard rendering.
 *
 * Note: Uses deferred interaction context (editReply, not reply).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEditPersona } from './edit.js';
import { mockGetPersonaResponse, mockListPersonasResponse } from '@tzurot/test-factories';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

// Valid UUIDs for tests
const TEST_PERSONA_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const DEFAULT_PERSONA_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

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
}));

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

describe('handleEditPersona', () => {
  const mockEditReply = vi.fn();
  let stub: PersonaClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    mockBuildDashboardEmbed.mockReturnValue({ title: 'Test Embed' });
    mockBuildDashboardComponents.mockReturnValue([]);
    mockEditReply.mockResolvedValue({ id: 'message-123' });
  });

  function createMockContext() {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: { user: { id: '123456789', username: 'testuser' } },
      channelId: 'channel-123',
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleEditPersona>[0];
  }

  describe('when personaId is provided', () => {
    it('should fetch specific persona and show dashboard', async () => {
      stub.getPersona.mockResolvedValue(
        makeOk(
          mockGetPersonaResponse({
            persona: {
              id: TEST_PERSONA_ID,
              name: 'Test Persona',
              preferredName: 'Tester',
              pronouns: 'they/them',
              content: 'Test content',
              description: 'Test description',
            },
          })
        )
      );

      await handleEditPersona(createMockContext(), TEST_PERSONA_ID);

      expect(stub.getPersona).toHaveBeenCalledWith(TEST_PERSONA_ID);
      expect(mockBuildDashboardEmbed).toHaveBeenCalled();
      expect(mockBuildDashboardComponents).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)],
        components: expect.any(Array),
      });
      expect(mockSessionSet).toHaveBeenCalled();
    });

    it('should show error when specific persona not found', async () => {
      stub.getPersona.mockResolvedValue(makeErr(404, 'Persona not found'));

      await handleEditPersona(createMockContext(), TEST_PERSONA_ID);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Persona not found'),
      });
      expect(mockBuildDashboardEmbed).not.toHaveBeenCalled();
    });
  });

  describe('when personaId is not provided', () => {
    it('should fetch default persona and show dashboard', async () => {
      stub.listPersonas.mockResolvedValue(
        makeOk(
          mockListPersonasResponse([
            { id: DEFAULT_PERSONA_ID, name: 'Default Persona', isDefault: true },
          ])
        )
      );
      stub.getPersona.mockResolvedValue(
        makeOk(
          mockGetPersonaResponse({
            persona: {
              id: DEFAULT_PERSONA_ID,
              name: 'Default Persona',
              isDefault: true,
              preferredName: null,
              pronouns: null,
              content: '',
              description: null,
            },
          })
        )
      );

      await handleEditPersona(createMockContext(), null);

      expect(stub.listPersonas).toHaveBeenCalled();
      expect(mockBuildDashboardEmbed).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalled();
    });

    it('should show "no personas" when the user genuinely has none (empty list)', async () => {
      stub.listPersonas.mockResolvedValue(makeOk(mockListPersonasResponse([])));

      await handleEditPersona(createMockContext(), null);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining("don't have any personas"),
      });
    });

    it('shows "try again" (not "no personas") when the persona-list fetch fails (infra)', async () => {
      // Previously a 500 here read as "you have no personas" — the conflation
      // this epic fixes. fetchDefaultPersona now throws → edit.ts catch.
      stub.listPersonas.mockResolvedValue(makeErr(500, 'Gateway error'));

      await handleEditPersona(createMockContext(), null);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('try again'),
      });
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      stub.getPersona.mockRejectedValue(new Error('Network error'));

      await handleEditPersona(createMockContext(), TEST_PERSONA_ID);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to load persona'),
      });
    });
  });
});
