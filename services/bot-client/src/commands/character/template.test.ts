/**
 * Tests for Character Template Subcommand
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTemplate } from './template.js';
import { AttachmentBuilder } from 'discord.js';
import { CHARACTER_JSON_TEMPLATE } from './import.js';
import type { EnvConfig } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

describe('handleTemplate', () => {
  const mockEditReply = vi.fn();
  const mockConfig = {} as EnvConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEditReply.mockResolvedValue(undefined);
  });

  function createMockContext(): DeferredCommandContext {
    return {
      editReply: mockEditReply,
    } as unknown as DeferredCommandContext;
  }

  it('should reply with a JSON file attachment', async () => {
    await handleTemplate(createMockContext(), mockConfig);

    expect(mockEditReply).toHaveBeenCalledTimes(1);
    const replyCall = mockEditReply.mock.calls[0][0];

    // Should include files array with one attachment
    expect(replyCall.files).toBeDefined();
    expect(replyCall.files).toHaveLength(1);
    expect(replyCall.files[0]).toBeInstanceOf(AttachmentBuilder);
  });

  it('should name the file character_card_template.json', async () => {
    await handleTemplate(createMockContext(), mockConfig);

    const replyCall = mockEditReply.mock.calls[0][0];
    const attachment = replyCall.files[0] as AttachmentBuilder;

    // Check the attachment name
    expect(attachment.name).toBe('character_card_template.json');
  });

  it('should include the template content in the attachment', async () => {
    await handleTemplate(createMockContext(), mockConfig);

    const replyCall = mockEditReply.mock.calls[0][0];
    const attachment = replyCall.files[0] as AttachmentBuilder;

    // The attachment should be a Buffer with the template content
    const buffer = attachment.attachment as Buffer;
    expect(buffer.toString('utf-8')).toBe(CHARACTER_JSON_TEMPLATE);
  });

  it('should include helpful instructions in the message', async () => {
    await handleTemplate(createMockContext(), mockConfig);

    const replyCall = mockEditReply.mock.calls[0][0];
    expect(replyCall.content).toContain('Character Import Template');
    expect(replyCall.content).toContain('Required fields');
    expect(replyCall.content).toContain('Slug format');
    expect(replyCall.content).toContain('/character import');
  });
});
