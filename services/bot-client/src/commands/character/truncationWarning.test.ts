/**
 * Tests for character truncation-warning flow
 *
 * Covers the three user-visible branches:
 * - detection picks up over-length fields per their modal maxLength
 * - the warning embed surfaces char counts + truncation amount
 * - the three buttons (Edit with Truncation / View Full / Cancel) route
 *   to handlers that each produce the expected Discord response shape
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';

// Mock common-types — logger, DISCORD_COLORS, isBotOwner, getConfig.
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    isBotOwner: vi.fn().mockReturnValue(false),
    getConfig: vi.fn().mockReturnValue({}),
  };
});

// Mock the character API to avoid gateway calls in tests.
const mockFetchCharacter = vi.fn();
vi.mock('./api.js', () => ({
  fetchCharacter: (...args: unknown[]) => mockFetchCharacter(...args),
}));

// Mock fetchOrCreateSession so the handlers see a stable data fixture.
const mockFetchOrCreateSession = vi.fn();
vi.mock('../../utils/dashboard/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/dashboard/index.js')>();
  return {
    ...actual,
    fetchOrCreateSession: (...args: unknown[]) => mockFetchOrCreateSession(...args),
    // The real buildSectionModal returns a ModalBuilder; stub it so the
    // handler tests don't depend on Discord.js modal internals.
    buildSectionModal: vi.fn().mockReturnValue({ __modal: true }),
  };
});

// Import after mocks so the factory resolves before module load.
const {
  detectOverLengthFields,
  buildTruncationWarningEmbed,
  buildTruncationButtons,
  showTruncationWarning,
  handleEditTruncatedButton,
  handleViewFullButton,
  handleCancelEditButton,
} = await import('./truncationWarning.js');

// A realistic character-identity section stub with two fields that have
// explicit maxLength values.
const identitySectionStub = {
  id: 'identity',
  label: '🏷️ Identity & Basics',
  description: 'test',
  fieldIds: ['personalityAge', 'personalityTraits'],
  fields: [
    { id: 'personalityAge', label: 'Age', maxLength: 100, style: 'short' as const },
    {
      id: 'personalityTraits',
      label: 'Traits',
      maxLength: 1000,
      style: 'paragraph' as const,
    },
  ],
  getStatus: () => 0,
  getPreview: () => '',
};

describe('detectOverLengthFields', () => {
  it('returns empty when no field exceeds its maxLength', () => {
    const data = {
      personalityAge: 'a short age',
      personalityTraits: 'short traits',
    } as unknown as Parameters<typeof detectOverLengthFields>[1];

    const result = detectOverLengthFields(identitySectionStub, data);
    expect(result).toEqual([]);
  });

  it('flags a field whose value exceeds the cap', () => {
    const data = {
      personalityAge: 'x'.repeat(150), // over the 100 cap
      personalityTraits: 'ok',
    } as unknown as Parameters<typeof detectOverLengthFields>[1];

    const result = detectOverLengthFields(identitySectionStub, data);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      fieldId: 'personalityAge',
      label: 'Age',
      current: 150,
      max: 100,
    });
  });

  it('flags multiple over-cap fields independently', () => {
    const data = {
      personalityAge: 'x'.repeat(150),
      personalityTraits: 'y'.repeat(1500),
    } as unknown as Parameters<typeof detectOverLengthFields>[1];

    const result = detectOverLengthFields(identitySectionStub, data);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.fieldId).sort()).toEqual(['personalityAge', 'personalityTraits']);
  });

  it('ignores non-string values and missing fields', () => {
    const data = {
      personalityAge: null,
      personalityTraits: undefined,
      unrelated: 'x'.repeat(5000),
    } as unknown as Parameters<typeof detectOverLengthFields>[1];

    const result = detectOverLengthFields(identitySectionStub, data);
    expect(result).toEqual([]);
  });
});

describe('buildTruncationWarningEmbed', () => {
  it('includes per-field char counts and the total truncation amount', () => {
    const embed = buildTruncationWarningEmbed(
      [
        { fieldId: 'personalityAge', label: 'Age', current: 150, max: 100 },
        {
          fieldId: 'personalityTraits',
          label: 'Traits',
          current: 1500,
          max: 1000,
        },
      ],
      '🏷️ Identity & Basics'
    );

    const json = embed.toJSON();
    expect(json.title).toContain('"Identity & Basics"');
    expect(json.description).toContain('Age');
    expect(json.description).toContain('150');
    expect(json.description).toContain('100');
    expect(json.description).toContain('Traits');
    expect(json.description).toContain('1,500');
    // Footer lists total truncation across all fields: (150-100)+(1500-1000)=550
    expect(json.footer?.text).toContain('550');
    expect(json.footer?.text).toContain('2 field');
  });
});

describe('buildTruncationButtons', () => {
  it('emits three buttons with character dashboard customId shape', () => {
    const row = buildTruncationButtons('char-1', 'identity');
    const json = row.toJSON();
    expect(json.components).toHaveLength(3);
    const customIds = json.components.map(c => (c as { custom_id: string }).custom_id);
    expect(customIds).toEqual([
      'character::edit-truncated::char-1::identity',
      'character::view-full::char-1::identity',
      'character::cancel-edit::char-1::identity',
    ]);
  });
});

describe('showTruncationWarning', () => {
  it('replies ephemerally with the warning embed and button row', async () => {
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const interaction = { reply: mockReply } as unknown as StringSelectMenuInteraction;

    await showTruncationWarning(interaction, identitySectionStub, 'char-1', [
      { fieldId: 'personalityAge', label: 'Age', current: 150, max: 100 },
    ]);

    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        embeds: expect.arrayContaining([expect.any(Object)]),
        components: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });
});

describe('handleEditTruncatedButton', () => {
  beforeEach(() => {
    mockFetchOrCreateSession.mockReset();
  });

  it('fetches the character and shows the section modal', async () => {
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Hero', _isAdmin: false },
    });
    const mockShowModal = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      showModal: mockShowModal,
    } as unknown as ButtonInteraction;

    await handleEditTruncatedButton(interaction, 'char-1', 'identity');

    expect(mockShowModal).toHaveBeenCalledWith({ __modal: true });
  });

  it('replies with an error when the character cannot be fetched', async () => {
    mockFetchOrCreateSession.mockResolvedValue({ success: false });
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const mockShowModal = vi.fn();
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
      showModal: mockShowModal,
    } as unknown as ButtonInteraction;

    await handleEditTruncatedButton(interaction, 'char-1', 'identity');

    expect(mockShowModal).not.toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Character not found'),
        flags: MessageFlags.Ephemeral,
      })
    );
  });

  it('replies with an error when the section id is unknown', async () => {
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
    } as unknown as ButtonInteraction;

    await handleEditTruncatedButton(interaction, 'char-1', 'nonexistent-section');

    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Unknown section'),
      })
    );
  });
});

describe('handleViewFullButton', () => {
  beforeEach(() => {
    mockFetchOrCreateSession.mockReset();
  });

  it('replies with txt attachments for each over-length field', async () => {
    const longValue = 'x'.repeat(150);
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { personalityAge: longValue, _isAdmin: false },
    });
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
    } as unknown as ButtonInteraction;

    await handleViewFullButton(interaction, 'char-1', 'identity');

    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        files: expect.arrayContaining([expect.any(Object)]),
        content: expect.stringContaining('Full content'),
      })
    );
    const callArg = mockReply.mock.calls[0][0] as { files: unknown[] };
    expect(callArg.files).toHaveLength(1);
  });

  it('reports no-op when content no longer exceeds cap', async () => {
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { personalityAge: 'short', _isAdmin: false },
    });
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
    } as unknown as ButtonInteraction;

    await handleViewFullButton(interaction, 'char-1', 'identity');

    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('No fields'),
        flags: MessageFlags.Ephemeral,
      })
    );
    expect(mockReply.mock.calls[0][0].files).toBeUndefined();
  });

  it('replies with an error when the character cannot be fetched', async () => {
    mockFetchOrCreateSession.mockResolvedValue({ success: false });
    const mockReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'user-1' },
      reply: mockReply,
    } as unknown as ButtonInteraction;

    await handleViewFullButton(interaction, 'char-1', 'identity');

    expect(mockReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Character not found'),
      })
    );
  });
});

describe('handleCancelEditButton', () => {
  it('updates the ephemeral message to a cancellation notice', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const interaction = { update: mockUpdate } as unknown as ButtonInteraction;

    await handleCancelEditButton(interaction);

    expect(mockUpdate).toHaveBeenCalledWith({
      content: '✅ Edit cancelled.',
      embeds: [],
      components: [],
    });
  });
});
