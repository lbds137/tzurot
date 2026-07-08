/**
 * Tests for Memory Detail Modal Handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildEditModal,
  handleEditButton,
  handleEditTruncatedButton,
  handleEditModalSubmit,
  MAX_MODAL_CONTENT_LENGTH,
} from './detailModals.js';
import type { MemoryItem } from '@tzurot/common-types/schemas/api/memory';
import { DiscordAPIError } from 'discord.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

vi.mock('@tzurot/common-types/constants/discord', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/discord')>(
    '@tzurot/common-types/constants/discord'
  );
  return {
    ...actual,
    DISCORD_COLORS: {
      BLURPLE: 0x5865f2,
      WARNING: 0xfee75c,
      ERROR: 0xed4245,
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

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

vi.mock('../../utils/customIds.js', () => ({
  CUSTOM_ID_DELIMITER: '::',
}));

interface MemoryClientStub {
  getMemory: ReturnType<typeof vi.fn>;
  updateMemory: ReturnType<typeof vi.fn>;
}

function createStub(): MemoryClientStub {
  return {
    getMemory: vi.fn(),
    updateMemory: vi.fn(),
  };
}

describe('Memory Detail Modals', () => {
  let stub: MemoryClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  const createMockMemory = (overrides: Partial<MemoryItem> = {}): MemoryItem => ({
    id: 'memory-123',
    content: 'Test memory content',
    createdAt: '2025-06-15T12:00:00.000Z',
    updatedAt: '2025-06-15T12:00:00.000Z',
    personalityId: 'personality-456',
    personalityName: 'Lilith',
    isLocked: false,
    ...overrides,
  });

  describe('MAX_MODAL_CONTENT_LENGTH', () => {
    it('should be 2000 to match API validation', () => {
      expect(MAX_MODAL_CONTENT_LENGTH).toBe(2000);
    });
  });

  describe('buildEditModal', () => {
    it('should build edit modal with memory content', () => {
      const memory = createMockMemory({ content: 'Original content' });
      const modal = buildEditModal(memory);

      expect(modal.data.title).toBe('Edit Memory');
      expect(modal.data.custom_id).toContain('edit');
      expect(modal.data.custom_id).toContain(memory.id);
    });
  });

  describe('handleEditButton', () => {
    it('should show modal on edit click', async () => {
      const memory = createMockMemory();
      stub.getMemory.mockResolvedValue(makeOk({ memory }));

      const mockShowModal = vi.fn();
      const mockReply = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        showModal: mockShowModal,
        reply: mockReply,
      } as unknown as ButtonInteraction;

      await handleEditButton(interaction, 'memory-123');

      expect(mockShowModal).toHaveBeenCalled();
    });

    it('should show error if memory not found', async () => {
      stub.getMemory.mockResolvedValue(makeErr(404, 'Not found'));

      const mockShowModal = vi.fn();
      const mockReply = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        showModal: mockShowModal,
        reply: mockReply,
      } as unknown as ButtonInteraction;

      await handleEditButton(interaction, 'memory-123');

      expect(mockShowModal).not.toHaveBeenCalled();
      expect(mockReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Memory not found'),
        })
      );
    });

    it('should show the truncation warning instead of a modal for over-length content', async () => {
      const memory = createMockMemory({ content: 'x'.repeat(MAX_MODAL_CONTENT_LENGTH + 500) });
      stub.getMemory.mockResolvedValue(makeOk({ memory }));

      const mockShowModal = vi.fn();
      const mockReply = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        showModal: mockShowModal,
        reply: mockReply,
      } as unknown as ButtonInteraction;

      await handleEditButton(interaction, 'memory-123');

      expect(mockShowModal).not.toHaveBeenCalled();
      expect(mockReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('surfaces a followUp instead of crashing when the truncation-warning reply hits 10062', async () => {
      const memory = createMockMemory({ content: 'x'.repeat(MAX_MODAL_CONTENT_LENGTH + 500) });
      stub.getMemory.mockResolvedValue(makeOk({ memory }));

      const timeoutError = new DiscordAPIError(
        { code: 10062, message: 'Unknown interaction' },
        10062,
        404,
        'POST',
        '/interactions/x/y/callback',
        {}
      );
      const mockReply = vi.fn().mockRejectedValue(timeoutError);
      const mockFollowUp = vi.fn().mockResolvedValue(undefined);

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        showModal: vi.fn(),
        reply: mockReply,
        followUp: mockFollowUp,
      } as unknown as ButtonInteraction;

      await expect(handleEditButton(interaction, 'memory-123')).resolves.toBeUndefined();
      expect(mockFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Took too long') })
      );
    });

    it('surfaces a followUp instead of crashing when the error reply hits 10062', async () => {
      stub.getMemory.mockResolvedValue(makeErr(404, 'Not found'));

      const timeoutError = new DiscordAPIError(
        { code: 10062, message: 'Unknown interaction' },
        10062,
        404,
        'POST',
        '/interactions/x/y/callback',
        {}
      );
      const mockReply = vi.fn().mockRejectedValue(timeoutError);
      const mockFollowUp = vi.fn().mockResolvedValue(undefined);

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        showModal: vi.fn(),
        reply: mockReply,
        followUp: mockFollowUp,
      } as unknown as ButtonInteraction;

      await expect(handleEditButton(interaction, 'memory-123')).resolves.toBeUndefined();
      expect(mockFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Memory not found') })
      );
    });
  });

  describe('handleEditTruncatedButton', () => {
    it('shows the modal with content sliced to MAX_MODAL_CONTENT_LENGTH', async () => {
      const memory = createMockMemory({ content: 'y'.repeat(MAX_MODAL_CONTENT_LENGTH + 1234) });
      stub.getMemory.mockResolvedValue(makeOk({ memory }));

      const mockShowModal = vi.fn();
      const mockUpdate = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        showModal: mockShowModal,
        update: mockUpdate,
      } as unknown as ButtonInteraction;

      await handleEditTruncatedButton(interaction, 'memory-123');

      expect(mockShowModal).toHaveBeenCalledTimes(1);
      const modal = mockShowModal.mock.calls[0][0] as ReturnType<typeof buildEditModal>;
      const json = modal.toJSON() as { components: { components: { value?: string }[] }[] };
      expect(json.components[0].components[0].value).toHaveLength(MAX_MODAL_CONTENT_LENGTH);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('updates the warning message with an error when the memory is gone', async () => {
      stub.getMemory.mockResolvedValue(makeErr(404, 'Not found'));

      const mockShowModal = vi.fn();
      const mockUpdate = vi.fn();

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        showModal: mockShowModal,
        update: mockUpdate,
      } as unknown as ButtonInteraction;

      await handleEditTruncatedButton(interaction, 'memory-123');

      expect(mockShowModal).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Memory not found'),
          embeds: [],
          components: [],
        })
      );
    });

    it('surfaces a followUp instead of crashing when the error update hits 10062', async () => {
      stub.getMemory.mockResolvedValue(makeErr(404, 'Not found'));

      const timeoutError = new DiscordAPIError(
        { code: 10062, message: 'Unknown interaction' },
        10062,
        404,
        'POST',
        '/interactions/x/y/callback',
        {}
      );
      const mockUpdate = vi.fn().mockRejectedValue(timeoutError);
      const mockFollowUp = vi.fn().mockResolvedValue(undefined);

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        showModal: vi.fn(),
        update: mockUpdate,
        followUp: mockFollowUp,
      } as unknown as ButtonInteraction;

      await expect(handleEditTruncatedButton(interaction, 'memory-123')).resolves.toBeUndefined();
      expect(mockFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Memory not found') })
      );
    });
  });

  describe('handleEditModalSubmit', () => {
    it('should update memory and show detail view', async () => {
      const memory = createMockMemory({ content: 'Updated content' });
      stub.updateMemory.mockResolvedValue(makeOk({ memory }));

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();
      const mockEditReply = vi.fn();
      const mockGetTextInputValue = vi.fn().mockReturnValue('Updated content');

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        fields: { getTextInputValue: mockGetTextInputValue },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
        editReply: mockEditReply,
      } as unknown as ModalSubmitInteraction;

      await handleEditModalSubmit(interaction, 'memory-123');

      expect(mockDeferUpdate).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalled();
    });

    it('surfaces the gateway message when the update is rejected (5xx)', async () => {
      stub.updateMemory.mockResolvedValue(makeErr(500, 'Update failed'));

      const mockDeferUpdate = vi.fn();
      const mockFollowUp = vi.fn();
      const mockGetTextInputValue = vi.fn().mockReturnValue('Updated content');

      const interaction = {
        user: { id: 'user-123', username: 'testuser' },
        fields: { getTextInputValue: mockGetTextInputValue },
        deferUpdate: mockDeferUpdate,
        followUp: mockFollowUp,
      } as unknown as ModalSubmitInteraction;

      await handleEditModalSubmit(interaction, 'memory-123');

      expect(mockFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Update failed'),
        })
      );
    });
  });
});
