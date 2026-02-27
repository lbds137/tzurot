/**
 * Tests for Persona Edit Handler
 * Tests gateway API calls and dashboard rendering.
 *
 * Note: Uses deferred interaction context (editReply, not reply).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEditPersona } from './edit.js';
import { mockGetPersonaResponse, mockListPersonasResponse } from '@tzurot/common-types';

// Valid UUIDs for tests
const TEST_PERSONA_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const DEFAULT_PERSONA_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

// Mock gateway client
// Note: Tests use objectContaining for API call assertions to focus on the essential
// userId parameter while ignoring implementation details like timeout values.
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  GATEWAY_TIMEOUTS: { AUTOCOMPLETE: 2500, DEFERRED: 10000 },
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
  };
});

describe('handleEditPersona', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildDashboardEmbed.mockReturnValue({ title: 'Test Embed' });
    mockBuildDashboardComponents.mockReturnValue([]);
    mockEditReply.mockResolvedValue({ id: 'message-123' });
  });

  function createMockContext() {
    return {
      user: { id: '123456789' },
      channelId: 'channel-123',
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleEditPersona>[0];
  }

  describe('when personaId is provided', () => {
    it('should fetch specific persona and show dashboard', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: mockGetPersonaResponse({
          persona: {
            id: TEST_PERSONA_ID,
            name: 'Test Persona',
            preferredName: 'Tester',
            pronouns: 'they/them',
            content: 'Test content',
            description: 'Test description',
          },
        }),
      });

      await handleEditPersona(createMockContext(), TEST_PERSONA_ID);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        `/user/persona/${TEST_PERSONA_ID}`,
        expect.objectContaining({ userId: '123456789' })
      );
      expect(mockBuildDashboardEmbed).toHaveBeenCalled();
      expect(mockBuildDashboardComponents).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)],
        components: expect.any(Array),
      });
      expect(mockSessionSet).toHaveBeenCalled();
    });

    it('should show error when specific persona not found', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Persona not found',
      });

      await handleEditPersona(createMockContext(), TEST_PERSONA_ID);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Persona not found'),
      });
      expect(mockBuildDashboardEmbed).not.toHaveBeenCalled();
    });
  });

  describe('when personaId is not provided', () => {
    it('should fetch default persona and show dashboard', async () => {
      // First call: list personas to find default
      mockCallGatewayApi.mockResolvedValueOnce({
        ok: true,
        data: mockListPersonasResponse([
          { id: DEFAULT_PERSONA_ID, name: 'Default Persona', isDefault: true },
        ]),
      });
      // Second call: fetch persona details
      mockCallGatewayApi.mockResolvedValueOnce({
        ok: true,
        data: mockGetPersonaResponse({
          persona: {
            id: DEFAULT_PERSONA_ID,
            name: 'Default Persona',
            isDefault: true,
            preferredName: null,
            pronouns: null,
            content: '',
            description: null,
          },
        }),
      });

      await handleEditPersona(createMockContext(), null);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/persona',
        expect.objectContaining({ userId: '123456789' })
      );
      expect(mockBuildDashboardEmbed).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalled();
    });

    it('should show error when user has no personas', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'No default persona',
      });

      await handleEditPersona(createMockContext(), null);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining("don't have any personas"),
      });
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleEditPersona(createMockContext(), TEST_PERSONA_ID);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to load persona'),
      });
    });
  });
});
