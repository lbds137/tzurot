/**
 * Tests for Preset Template Command
 *
 * Tests the /preset template functionality:
 * - Downloads JSON template file
 * - Includes helpful instructions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AttachmentBuilder } from 'discord.js';
import { handleTemplate } from './template.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

// Mock dependencies
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('Preset Template', () => {
  const createMockContext = (): DeferredCommandContext =>
    ({
      user: { id: 'user-123', username: 'testuser' },
      interaction: {
        options: {},
      },
      editReply: vi.fn(),
    }) as unknown as DeferredCommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleTemplate', () => {
    it('should return JSON template file', async () => {
      const mockContext = createMockContext();

      await handleTemplate(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          files: expect.arrayContaining([expect.any(AttachmentBuilder)]),
        })
      );
    });

    it('should include helpful instructions in message', async () => {
      const mockContext = createMockContext();

      await handleTemplate(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('/preset import'),
        })
      );
    });

    it('should mention required fields in message', async () => {
      const mockContext = createMockContext();

      await handleTemplate(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('name'),
        })
      );
      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('model'),
        })
      );
    });

    it('should mention optional sections in message', async () => {
      const mockContext = createMockContext();

      await handleTemplate(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('advancedParameters'),
        })
      );
    });
  });
});
