/**
 * Tests for Personality Create Modal Subcommand Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction, User } from 'discord.js';

// Mock logger and Discord limits
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    DISCORD_LIMITS: {
      EMBED_DESCRIPTION: 4000, // Modal text inputs max is 4000, not 4096
    },
  };
});

import { handleCreateModal } from './create-modal.js';

describe('handleCreateModal', () => {
  let mockInteraction: ChatInputCommandInteraction;
  let mockUser: User;

  beforeEach(() => {
    vi.clearAllMocks();

    mockUser = {
      tag: 'TestUser#1234',
    } as User;

    mockInteraction = {
      user: mockUser,
      showModal: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;
  });

  it('should show modal to user', async () => {
    await handleCreateModal(mockInteraction);

    expect(mockInteraction.showModal).toHaveBeenCalledOnce();
  });

  it('should not throw errors', async () => {
    await expect(handleCreateModal(mockInteraction)).resolves.not.toThrow();
  });
});
