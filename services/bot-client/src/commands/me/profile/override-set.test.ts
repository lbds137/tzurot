/**
 * Tests for Override Set Handler
 * Tests gateway API calls for setting per-personality profile overrides.
 *
 * Uses validated mock factories from @tzurot/common-types to ensure
 * test mocks match actual gateway API responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOverrideSet, handleOverrideCreateModalSubmit } from './override-set.js';
import { MessageFlags } from 'discord.js';
import { CREATE_NEW_PERSONA_VALUE } from '../autocomplete.js';
import {
  mockSetOverrideResponse,
  mockOverrideInfoResponse,
  mockCreateOverrideResponse,
} from '@tzurot/common-types';

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
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
    // Ensure truncateText is available (in case of build cache issues)
    truncateText: (text: string, maxLength: number, ellipsis = '…') => {
      if (!text) return '';
      if (text.length <= maxLength) return text;
      return text.slice(0, maxLength - ellipsis.length) + ellipsis;
    },
  };
});

describe('handleOverrideSet', () => {
  const mockReply = vi.fn();
  const mockShowModal = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockShowModal.mockResolvedValue(undefined);
  });

  function createMockContext(personalitySlug: string, personaId: string) {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: {
        options: {
          getString: (name: string) => {
            if (name === 'personality') return personalitySlug;
            if (name === 'profile') return personaId;
            return null;
          },
        },
      },
      reply: mockReply,
      showModal: mockShowModal,
    } as unknown as Parameters<typeof handleOverrideSet>[0];
  }

  it('should set existing persona as override', async () => {
    // Use validated factory - ensures mock matches actual gateway response
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockSetOverrideResponse({
        personality: { name: 'Lilith', displayName: 'Lilith' },
        persona: { name: 'Work Persona', preferredName: 'Alice' },
      }),
    });

    await handleOverrideSet(createMockContext('lilith', 'persona-123'));

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/override/lilith', {
      userId: '123456789',
      method: 'PUT',
      body: { personaId: 'persona-123' },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile override set'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show create modal when CREATE_NEW_PERSONA_VALUE selected', async () => {
    // Use validated factory for override info response
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockOverrideInfoResponse({
        personality: { name: 'Lilith', displayName: 'Lilith' },
      }),
    });

    await handleOverrideSet(createMockContext('lilith', CREATE_NEW_PERSONA_VALUE));

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/override/lilith', {
      userId: '123456789',
    });
    expect(mockShowModal).toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('should error if personality not found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Personality not found',
    });

    await handleOverrideSet(createMockContext('nonexistent', 'persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Personality "nonexistent" not found'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should error if user not found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'User has no account yet',
    });

    await handleOverrideSet(createMockContext('lilith', 'persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an account yet"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should error if profile not owned by user', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Profile not found',
    });

    await handleOverrideSet(createMockContext('lilith', 'other-persona'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile not found'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle gateway errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleOverrideSet(createMockContext('lilith', 'persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to set profile override'),
      flags: MessageFlags.Ephemeral,
    });
  });
});

describe('handleOverrideCreateModalSubmit', () => {
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockModalInteraction(fields: Record<string, string>) {
    return {
      user: { id: '123456789', username: 'testuser' },
      fields: {
        getTextInputValue: (name: string) => fields[name] ?? '',
      },
      reply: mockReply,
    } as any;
  }

  it('should create new persona and set as override', async () => {
    // Use validated factory for create override response
    // NOTE: POST /user/persona/override/by-id/:id endpoint needs to be implemented
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockCreateOverrideResponse({
        persona: {
          name: 'Lilith Persona',
          preferredName: 'Alice',
          description: 'For Lilith only',
          pronouns: 'she/her',
          content: 'Special content for Lilith',
        },
        personality: {
          name: 'Lilith',
          displayName: 'Lilith',
        },
      }),
    });

    await handleOverrideCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Lilith Persona',
        description: 'For Lilith only',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'Special content for Lilith',
      }),
      'personality-uuid'
    );

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/persona/override/by-id/personality-uuid',
      {
        userId: '123456789',
        method: 'POST',
        body: {
          name: 'Lilith Persona',
          description: 'For Lilith only',
          preferredName: 'Alice',
          pronouns: 'she/her',
          content: 'Special content for Lilith',
          username: 'testuser',
        },
      }
    );
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile "Lilith Persona" created'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should require profile name', async () => {
    await handleOverrideCreateModalSubmit(
      createMockModalInteraction({
        personaName: '',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      }),
      'personality-uuid'
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile name is required'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should error if user not found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'User not found',
    });

    await handleOverrideCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Test',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      }),
      'personality-uuid'
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('User not found'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle gateway errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleOverrideCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Test',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      }),
      'personality-uuid'
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to create profile'),
      flags: MessageFlags.Ephemeral,
    });
  });
});
