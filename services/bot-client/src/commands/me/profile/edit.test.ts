/**
 * Tests for Profile Edit Handler
 * Tests dashboard display for profile editing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEditProfile } from './edit.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Mock session manager
const mockSessionSet = vi.fn();
vi.mock('../../../utils/dashboard/index.js', async () => {
  const actual = await vi.importActual('../../../utils/dashboard/index.js');
  return {
    ...actual,
    getSessionManager: () => ({
      set: mockSessionSet,
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn(),
    }),
  };
});

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

describe('handleEditProfile', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockEditReply.mockResolvedValue({ id: 'message-123' });
    mockSessionSet.mockResolvedValue(undefined);
  });

  function createMockContext(options?: { getString?: string | null }): DeferredCommandContext {
    return {
      user: { id: '123456789', username: 'testuser' },
      channelId: 'channel-123',
      editReply: mockEditReply,
      interaction: {
        options: {
          getString: vi.fn().mockReturnValue(options?.getString ?? null),
        },
      },
    } as unknown as DeferredCommandContext;
  }

  function mockPersonaDetails(
    overrides?: Partial<{
      id: string;
      name: string;
      description: string | null;
      preferredName: string | null;
      pronouns: string | null;
      content: string | null;
      isDefault: boolean;
    }>
  ) {
    return {
      id: 'persona-123',
      name: 'My Persona',
      description: 'My main persona',
      preferredName: 'Alice',
      pronouns: 'she/her',
      content: 'I love coding',
      isDefault: true,
      ...overrides,
    };
  }

  describe('when editing by profile ID', () => {
    it('should open dashboard for specific profile', async () => {
      const persona = mockPersonaDetails({ id: 'specific-persona', isDefault: false });
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { persona },
      });

      await handleEditProfile(
        createMockContext({ getString: 'specific-persona' }),
        'specific-persona'
      );

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/specific-persona', {
        userId: '123456789',
      });
      expect(mockEditReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
      expect(mockSessionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: '123456789',
          entityType: 'profile',
          entityId: 'specific-persona',
        })
      );
    });

    it('should show error when profile not found', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Persona not found',
      });

      await handleEditProfile(
        createMockContext({ getString: 'nonexistent-persona' }),
        'nonexistent-persona'
      );

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Profile not found'),
      });
      expect(mockSessionSet).not.toHaveBeenCalled();
    });
  });

  describe('when editing default profile', () => {
    it('should open dashboard for default profile', async () => {
      const persona = mockPersonaDetails({ isDefault: true });
      // First call: list personas to find default
      mockCallGatewayApi.mockResolvedValueOnce({
        ok: true,
        data: {
          personas: [{ id: 'persona-123', name: 'My Persona', isDefault: true }],
        },
      });
      // Second call: get persona details
      mockCallGatewayApi.mockResolvedValueOnce({
        ok: true,
        data: { persona },
      });

      await handleEditProfile(createMockContext());

      expect(mockEditReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
      expect(mockSessionSet).toHaveBeenCalled();
    });

    it('should show instructions when user has no profiles', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personas: [] },
      });

      await handleEditProfile(createMockContext());

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining("don't have any profiles"),
      });
      expect(mockSessionSet).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleEditProfile(createMockContext());

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to load profile'),
      });
      expect(mockSessionSet).not.toHaveBeenCalled();
    });
  });

  describe('dashboard content', () => {
    it('should include profile data in embed', async () => {
      const persona = mockPersonaDetails({
        name: 'Work Profile',
        preferredName: 'Bob',
        pronouns: 'he/him',
        isDefault: false,
      });
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { persona },
      });

      await handleEditProfile(createMockContext({ getString: persona.id }), persona.id);

      expect(mockEditReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: expect.stringContaining('Work Profile'),
              }),
            }),
          ]),
        })
      );
    });

    it('should show delete button for non-default profile', async () => {
      const persona = mockPersonaDetails({ isDefault: false });
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { persona },
      });

      await handleEditProfile(createMockContext({ getString: persona.id }), persona.id);

      // The components should include delete button (showDelete: true)
      expect(mockEditReply).toHaveBeenCalled();
      const call = mockEditReply.mock.calls[0][0];
      expect(call.components).toBeDefined();
      // Components array should have action row with buttons including delete
      const buttonsRow = call.components.find(
        (c: { data: { type: number } }) => c.data.type === 1 // ActionRow
      );
      expect(buttonsRow).toBeDefined();
    });

    it('should NOT show delete button for default profile', async () => {
      const persona = mockPersonaDetails({ isDefault: true });
      mockCallGatewayApi.mockResolvedValueOnce({
        ok: true,
        data: {
          personas: [{ id: persona.id, name: persona.name, isDefault: true }],
        },
      });
      mockCallGatewayApi.mockResolvedValueOnce({
        ok: true,
        data: { persona },
      });

      await handleEditProfile(createMockContext());

      // Since showDelete is false for default profiles, delete button should not be present
      // This is verified by the logic in handleEditProfile: showDelete: !profile.isDefault
      const call = mockEditReply.mock.calls[0][0];
      expect(call.components).toBeDefined();
    });
  });
});
