/**
 * Tests for Character View Page Building
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { _testExports, handleView, handleViewPagination, handleExpandField } from './view.js';
import type { CharacterData } from './characterTypes.js';
import { DISCORD_LIMITS, TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';
import { sendChunkedReply } from '../../utils/chunkedReply.js';

// Configurable slug for the mocked characterViewOptions; reset per test.
const slugMock = vi.hoisted(() => ({ value: 'test-character' }));
const clientsForMock = vi.hoisted(() => vi.fn());

vi.mock('@tzurot/common-types/generated/commandOptions', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/generated/commandOptions')
  >('@tzurot/common-types/generated/commandOptions');
  return {
    ...actual,
    characterViewOptions: () => ({ character: () => slugMock.value }),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('../../utils/gatewayClients.js', () => ({ clientsFor: clientsForMock }));
vi.mock('../../utils/chunkedReply.js', () => ({ sendChunkedReply: vi.fn() }));

const {
  buildCharacterViewPage,
  truncateField,
  buildViewComponents,
  VIEW_TOTAL_PAGES,
  VIEW_PAGE_TITLES,
  EXPANDABLE_FIELDS,
} = _testExports;

/**
 * Create a minimal valid CharacterData for testing
 */
function createTestCharacter(overrides: Partial<CharacterData> = {}): CharacterData {
  return {
    id: 'test-id',
    name: 'Test Character',
    displayName: null,
    slug: 'test-character',
    characterInfo: 'Test background info',
    personalityTraits: 'Test traits',
    personalityTone: null,
    personalityAge: null,
    personalityAppearance: null,
    personalityLikes: null,
    personalityDislikes: null,
    conversationalGoals: null,
    conversationalExamples: null,
    errorMessage: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    isPublic: false,
    definitionPublic: false,
    definitionRedacted: false,
    voiceEnabled: false,
    hasVoiceReference: false,
    imageEnabled: false,
    ownerId: 'owner-123',
    avatarData: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('View Page Constants', () => {
  it('should have exactly 4 pages', () => {
    expect(VIEW_TOTAL_PAGES).toBe(4);
  });

  it('should have 4 page titles matching page count', () => {
    expect(VIEW_PAGE_TITLES).toHaveLength(VIEW_TOTAL_PAGES);
  });

  it('should have correct page titles aligned with edit sections', () => {
    expect(VIEW_PAGE_TITLES[0]).toContain('Identity');
    expect(VIEW_PAGE_TITLES[1]).toContain('Biography');
    expect(VIEW_PAGE_TITLES[2]).toContain('Preferences');
    expect(VIEW_PAGE_TITLES[3]).toContain('Conversation');
  });

  it('should have expandable field definitions for all long fields', () => {
    const expectedFields = [
      'characterInfo',
      'personalityTraits',
      'personalityAppearance',
      'personalityLikes',
      'personalityDislikes',
      'conversationalGoals',
      'conversationalExamples',
      'errorMessage',
    ];

    for (const field of expectedFields) {
      expect(EXPANDABLE_FIELDS[field], `Missing expandable field: ${field}`).toBeDefined();
      expect(EXPANDABLE_FIELDS[field].label).toBeTruthy();
      expect(EXPANDABLE_FIELDS[field].key).toBe(field);
    }
  });
});

describe('truncateField', () => {
  it('should return "_Not set_" for null values', () => {
    const result = truncateField(null);
    expect(result.value).toBe('_Not set_');
    expect(result.wasTruncated).toBe(false);
    expect(result.originalLength).toBe(0);
  });

  it('should return "_Not set_" for undefined values', () => {
    const result = truncateField(undefined);
    expect(result.value).toBe('_Not set_');
    expect(result.wasTruncated).toBe(false);
  });

  it('should return "_Not set_" for empty strings', () => {
    const result = truncateField('');
    expect(result.value).toBe('_Not set_');
    expect(result.wasTruncated).toBe(false);
  });

  it('should not truncate short text', () => {
    const shortText = 'This is a short text';
    const result = truncateField(shortText);
    expect(result.value).toBe(shortText);
    expect(result.wasTruncated).toBe(false);
    expect(result.originalLength).toBe(shortText.length);
  });

  it('should truncate text exceeding default limit', () => {
    // Default max is DISCORD_LIMITS.EMBED_FIELD - suffix length
    const longText = 'x'.repeat(DISCORD_LIMITS.EMBED_FIELD + 100);
    const result = truncateField(longText);

    expect(result.wasTruncated).toBe(true);
    expect(result.originalLength).toBe(longText.length);
    expect(result.value.endsWith(TEXT_LIMITS.TRUNCATION_SUFFIX)).toBe(true);
    expect(result.value.length).toBeLessThanOrEqual(DISCORD_LIMITS.EMBED_FIELD);
  });

  it('should respect custom maxLength', () => {
    const text = 'This is a longer text that should be truncated';
    const result = truncateField(text, 20);

    expect(result.wasTruncated).toBe(true);
    expect(result.value.length).toBeLessThanOrEqual(20 + TEXT_LIMITS.TRUNCATION_SUFFIX.length);
  });

  it('should not exceed Discord embed field limit even with high maxLength', () => {
    const longText = 'x'.repeat(2000);
    const result = truncateField(longText, 5000); // Request more than Discord allows

    expect(result.value.length).toBeLessThanOrEqual(DISCORD_LIMITS.EMBED_FIELD);
  });
});

describe('buildCharacterViewPage', () => {
  describe('Page 0: Overview & Identity', () => {
    it('should show character name and slug', () => {
      const character = createTestCharacter({ name: 'Luna', slug: 'luna-test' });
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      expect(json.title).toContain('Luna');
      expect(json.title).toContain('Identity');

      const identityField = json.fields?.find(f => f.name.includes('Identity'));
      expect(identityField?.value).toContain('Luna');
      expect(identityField?.value).toContain('luna-test');
    });

    it('should show display name when set', () => {
      const character = createTestCharacter({
        name: 'Luna',
        displayName: 'Luna the Wise',
      });
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      expect(json.title).toContain('Luna the Wise');
    });

    it('should show settings (visibility, voice, images)', () => {
      const character = createTestCharacter({
        isPublic: true,
        voiceEnabled: true,
        hasVoiceReference: true,
        imageEnabled: false,
      });
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      const settingsField = json.fields?.find(f => f.name.includes('Settings'));
      expect(settingsField?.value).toContain('Public');
      expect(settingsField?.value).toContain('Enabled'); // Voice
    });

    it('should show traits, tone, and age', () => {
      const character = createTestCharacter({
        personalityTraits: 'Curious and playful',
        personalityTone: 'friendly',
        personalityAge: '25',
      });
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      const traitsField = json.fields?.find(f => f.name.includes('Traits'));
      expect(traitsField?.value).toContain('Curious and playful');

      const toneField = json.fields?.find(f => f.name.includes('Tone'));
      expect(toneField?.value).toBe('friendly');

      const ageField = json.fields?.find(f => f.name.includes('Age'));
      expect(ageField?.value).toBe('25');
    });

    it('should track truncated traits field', () => {
      const character = createTestCharacter({
        personalityTraits: 'x'.repeat(1000), // Will be truncated
      });
      const { truncatedFields } = buildCharacterViewPage(character, 0);

      expect(truncatedFields).toContain('personalityTraits');
    });
  });

  describe('Page 1: Biography & Appearance', () => {
    it('should show characterInfo and appearance', () => {
      const character = createTestCharacter({
        characterInfo: 'A mystical creature from ancient times',
        personalityAppearance: 'Tall with silver hair',
      });
      const { embed } = buildCharacterViewPage(character, 1);
      const json = embed.toJSON();

      expect(json.title).toContain('Biography');

      const infoField = json.fields?.find(f => f.name.includes('Character Info'));
      expect(infoField?.value).toContain('mystical creature');

      const appearanceField = json.fields?.find(f => f.name.includes('Appearance'));
      expect(appearanceField?.value).toContain('silver hair');
    });

    it('should show "_Not set_" for missing appearance', () => {
      const character = createTestCharacter({
        characterInfo: 'Some info',
        personalityAppearance: null,
      });
      const { embed } = buildCharacterViewPage(character, 1);
      const json = embed.toJSON();

      const appearanceField = json.fields?.find(f => f.name.includes('Appearance'));
      expect(appearanceField?.value).toBe('_Not set_');
    });

    it('should track truncated fields', () => {
      const character = createTestCharacter({
        characterInfo: 'x'.repeat(2000),
        personalityAppearance: 'y'.repeat(2000),
      });
      const { truncatedFields } = buildCharacterViewPage(character, 1);

      expect(truncatedFields).toContain('characterInfo');
      expect(truncatedFields).toContain('personalityAppearance');
    });
  });

  describe('Page 2: Preferences', () => {
    it('should show likes and dislikes', () => {
      const character = createTestCharacter({
        personalityLikes: 'Music, art, stargazing',
        personalityDislikes: 'Loud noises, crowds',
      });
      const { embed } = buildCharacterViewPage(character, 2);
      const json = embed.toJSON();

      expect(json.title).toContain('Preferences');

      const likesField = json.fields?.find(f => f.name.includes('Likes'));
      expect(likesField?.value).toContain('Music');

      const dislikesField = json.fields?.find(f => f.name.includes('Dislikes'));
      expect(dislikesField?.value).toContain('Loud noises');
    });

    it('should show "_Not set_" for missing preferences', () => {
      const character = createTestCharacter({
        personalityLikes: null,
        personalityDislikes: null,
      });
      const { embed } = buildCharacterViewPage(character, 2);
      const json = embed.toJSON();

      const likesField = json.fields?.find(f => f.name.includes('Likes'));
      expect(likesField?.value).toBe('_Not set_');
    });

    it('should track truncated fields', () => {
      const character = createTestCharacter({
        personalityLikes: 'x'.repeat(2000),
        personalityDislikes: 'y'.repeat(2000),
      });
      const { truncatedFields } = buildCharacterViewPage(character, 2);

      expect(truncatedFields).toContain('personalityLikes');
      expect(truncatedFields).toContain('personalityDislikes');
    });
  });

  describe('Page 3: Conversation & Errors', () => {
    it('should show goals, examples, and error message', () => {
      const character = createTestCharacter({
        conversationalGoals: 'Be helpful and engaging',
        conversationalExamples: 'User: Hi\nBot: Hello there!',
        errorMessage: 'Oops, something went wrong',
      });
      const { embed } = buildCharacterViewPage(character, 3);
      const json = embed.toJSON();

      expect(json.title).toContain('Conversation');

      const goalsField = json.fields?.find(f => f.name.includes('Goals'));
      expect(goalsField?.value).toContain('helpful');

      const examplesField = json.fields?.find(f => f.name.includes('Example'));
      expect(examplesField?.value).toContain('Hello there');

      const errorField = json.fields?.find(f => f.name.includes('Error'));
      expect(errorField?.value).toContain('went wrong');
    });

    it('should track truncated fields', () => {
      const character = createTestCharacter({
        conversationalGoals: 'x'.repeat(2000),
        conversationalExamples: 'y'.repeat(2000),
        errorMessage: 'z'.repeat(2000),
      });
      const { truncatedFields } = buildCharacterViewPage(character, 3);

      expect(truncatedFields).toContain('conversationalGoals');
      expect(truncatedFields).toContain('conversationalExamples');
      expect(truncatedFields).toContain('errorMessage');
    });
  });

  describe('Page boundary handling', () => {
    it('should clamp negative page numbers to 0', () => {
      const character = createTestCharacter();
      const { embed } = buildCharacterViewPage(character, -1);
      const json = embed.toJSON();

      expect(json.title).toContain('Identity');
    });

    it('should clamp page numbers exceeding max to last page', () => {
      const character = createTestCharacter();
      const { embed } = buildCharacterViewPage(character, 100);
      const json = embed.toJSON();

      expect(json.title).toContain('Conversation');
    });
  });

  describe('embed metadata', () => {
    it('should include footer with dates', () => {
      const character = createTestCharacter({
        createdAt: '2024-06-15T00:00:00Z',
        updatedAt: '2024-07-20T00:00:00Z',
      });
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      expect(json.footer?.text).toContain('Created:');
      expect(json.footer?.text).toContain('Updated:');
    });

    it('should have timestamp', () => {
      const character = createTestCharacter();
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      expect(json.timestamp).toBeDefined();
    });
  });
});

describe('buildViewComponents', () => {
  it('should include navigation buttons', () => {
    const components = buildViewComponents('test-slug', 1, []);

    expect(components.length).toBeGreaterThan(0);

    // First row should be navigation
    const navRow = components[0];
    const navButtons = navRow.components;

    expect(navButtons.length).toBe(3); // Previous, Page indicator, Next
  });

  it('should disable previous button on first page', () => {
    const components = buildViewComponents('test-slug', 0, []);
    const navRow = components[0];
    const prevButton = navRow.components[0];

    expect(prevButton.data.disabled).toBe(true);
  });

  it('should disable next button on last page', () => {
    const components = buildViewComponents('test-slug', VIEW_TOTAL_PAGES - 1, []);
    const navRow = components[0];
    const nextButton = navRow.components[2];

    expect(nextButton.data.disabled).toBe(true);
  });

  it('should add expand buttons for truncated fields', () => {
    const truncatedFields = ['characterInfo', 'personalityLikes'];
    const components = buildViewComponents('test-slug', 1, truncatedFields);

    // Should have nav row + expand row
    expect(components.length).toBe(2);

    const expandRow = components[1];
    expect(expandRow.components.length).toBe(2);
  });

  it('should not add expand row when no fields are truncated', () => {
    const components = buildViewComponents('test-slug', 0, []);

    expect(components.length).toBe(1); // Only nav row
  });

  it('should limit expand buttons to 5 per row (Discord limit)', () => {
    const manyTruncatedFields = [
      'characterInfo',
      'personalityTraits',
      'personalityAppearance',
      'personalityLikes',
      'personalityDislikes',
      'conversationalGoals',
      'conversationalExamples',
    ];
    const components = buildViewComponents('test-slug', 0, manyTruncatedFields);

    // First row is nav, subsequent rows are expand buttons
    for (let i = 1; i < components.length; i++) {
      expect(components[i].components.length).toBeLessThanOrEqual(5);
    }
  });

  it('should not exceed 5 total rows (Discord limit)', () => {
    const manyTruncatedFields = [
      'characterInfo',
      'personalityTraits',
      'personalityAppearance',
      'personalityLikes',
      'personalityDislikes',
      'conversationalGoals',
      'conversationalExamples',
      'errorMessage',
    ];
    const components = buildViewComponents('test-slug', 0, manyTruncatedFields);

    expect(components.length).toBeLessThanOrEqual(5);
  });
});

describe('handleView / handleViewPagination', () => {
  const editReply = vi.fn();
  const deferUpdate = vi.fn();
  const stub = { getPersonality: vi.fn() };
  const config = {} as unknown as Parameters<typeof handleView>[1];

  beforeEach(() => {
    vi.clearAllMocks();
    slugMock.value = 'test-character';
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function viewContext() {
    return { interaction: {}, editReply } as unknown as Parameters<typeof handleView>[0];
  }

  function paginationInteraction() {
    return { deferUpdate, editReply } as unknown as Parameters<typeof handleViewPagination>[0];
  }

  it('renders the Components-V2 payload (flag + component tree, no embeds) when found', async () => {
    stub.getPersonality.mockResolvedValue(makeOk({ personality: createTestCharacter() }));

    await handleView(viewContext(), config);

    expect(stub.getPersonality).toHaveBeenCalledWith('test-character');
    // D17 pilot: the handler sends a V2 tree — the flag must ride the edit
    const call = editReply.mock.calls[0][0];
    expect(call.flags).toBe(MessageFlags.IsComponentsV2);
    expect(call.components.length).toBeGreaterThan(0);
    expect(call.embeds).toBeUndefined();
  });

  it('shows a not-found message on a 404', async () => {
    stub.getPersonality.mockResolvedValue(makeErr(404, 'not found'));

    await handleView(viewContext(), config);

    expect(editReply).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('renders the private-definition state with NO components when redacted', async () => {
    // Non-owner of a definition-private character: card fields arrive null +
    // definitionRedacted true. Must read as "private", not "abandoned".
    stub.getPersonality.mockResolvedValue(
      makeOk({
        personality: createTestCharacter({
          definitionRedacted: true,
          characterInfo: '',
          personalityTraits: '',
        }),
      })
    );

    await handleView(viewContext(), config);

    const call = editReply.mock.calls[0][0];
    // Redacted V2 view: one Container, no interactive components
    expect(call.flags).toBe(MessageFlags.IsComponentsV2);
    expect(call.components).toHaveLength(1);
    const rendered = JSON.stringify(call.components[0].toJSON());
    expect(rendered).toContain('definition is private');
    // Public-safe identity still shows; no "_Not set_" card fields.
    expect(rendered).toContain('test-character');
  });

  it('collapses a stale pagination click on a now-redacted character to the private page', async () => {
    stub.getPersonality.mockResolvedValue(
      makeOk({ personality: createTestCharacter({ definitionRedacted: true }) })
    );

    await handleViewPagination(paginationInteraction(), 'test-character', 2, config);

    const call = editReply.mock.calls[0][0];
    expect(call.flags).toBe(MessageFlags.IsComponentsV2);
    expect(call.components).toHaveLength(1);
    expect(JSON.stringify(call.components[0].toJSON())).toContain('definition is private');
  });

  it('surfaces the gateway message when the fetch fails with a non-404 status', async () => {
    // fetchCharacterForView throws typed GatewayApiError on non-404/403 →
    // handleView's catch classifies and surfaces the gateway's own message.
    stub.getPersonality.mockResolvedValue(makeErr(500, 'boom'));

    await handleView(viewContext(), config);

    expect(editReply).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('paginates: defers, re-fetches, and renders the requested page', async () => {
    stub.getPersonality.mockResolvedValue(makeOk({ personality: createTestCharacter() }));

    await handleViewPagination(paginationInteraction(), 'test-character', 1, config);

    expect(deferUpdate).toHaveBeenCalled();
    expect(stub.getPersonality).toHaveBeenCalledWith('test-character');
    // D17 pilot: page flips must carry the V2 flag on every edit
    const call = editReply.mock.calls[0][0];
    expect(call.flags).toBe(MessageFlags.IsComponentsV2);
    expect(call.components.length).toBeGreaterThan(0);
  });

  it('shows "not found" as a V2 tree when pagination re-fetch 404s', async () => {
    stub.getPersonality.mockResolvedValue(makeErr(404, 'gone'));

    await handleViewPagination(paginationInteraction(), 'test-character', 1, config);

    expect(deferUpdate).toHaveBeenCalled();
    // The flag must ride even the error edit: the message is already V2, and
    // a flag-less `content` edit is rejected by Discord (user sees nothing).
    const call = editReply.mock.calls[0][0];
    expect(call.flags).toBe(MessageFlags.IsComponentsV2);
    expect(call.content).toBeUndefined();
    expect(JSON.stringify(call.components[0].toJSON())).toContain('Character not found');
  });

  it('keeps the existing view (no editReply) when pagination re-fetch fails with a non-404', async () => {
    // fetchCharacterForView throws on 500 → the catch logs and intentionally
    // leaves the current page in place so the user can retry.
    stub.getPersonality.mockResolvedValue(makeErr(500, 'boom'));

    await handleViewPagination(paginationInteraction(), 'test-character', 1, config);

    expect(deferUpdate).toHaveBeenCalled();
    expect(editReply).not.toHaveBeenCalled();
  });
});

describe('handleExpandField', () => {
  const editReply = vi.fn();
  const deferReply = vi.fn();
  const stub = { getPersonality: vi.fn() };
  const config = {} as unknown as Parameters<typeof handleExpandField>[3];

  beforeEach(() => {
    vi.clearAllMocks();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function expandInteraction() {
    return { deferReply, editReply, deferred: true, replied: false } as unknown as Parameters<
      typeof handleExpandField
    >[0];
  }

  it('defers ephemerally and sends the full field content via chunked reply', async () => {
    const character = createTestCharacter({ characterInfo: 'Full unabridged background text' });
    stub.getPersonality.mockResolvedValue(makeOk({ personality: character }));

    await handleExpandField(expandInteraction(), 'test-character', 'characterInfo', config);

    expect(deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(sendChunkedReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Full unabridged background text',
        header: expect.stringContaining(EXPANDABLE_FIELDS.characterInfo.label),
      })
    );
    expect(editReply).not.toHaveBeenCalled();
  });

  it('shows "not found" when the character fetch 404s', async () => {
    stub.getPersonality.mockResolvedValue(makeErr(404, 'gone'));

    await handleExpandField(expandInteraction(), 'test-character', 'characterInfo', config);

    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Character not found'),
    });
    expect(sendChunkedReply).not.toHaveBeenCalled();
  });

  it('shows "Unknown field" for a field name with no expandable definition', async () => {
    stub.getPersonality.mockResolvedValue(makeOk({ personality: createTestCharacter() }));

    await handleExpandField(expandInteraction(), 'test-character', 'noSuchField', config);

    expect(editReply).toHaveBeenCalledWith({ content: expect.stringContaining('Unknown field') });
    expect(sendChunkedReply).not.toHaveBeenCalled();
  });

  it('shows "_Not set_" when the field exists but has no content', async () => {
    const character = createTestCharacter({ personalityLikes: null });
    stub.getPersonality.mockResolvedValue(makeOk({ personality: character }));

    await handleExpandField(expandInteraction(), 'test-character', 'personalityLikes', config);

    expect(editReply).toHaveBeenCalledWith(expect.stringContaining('_Not set_'));
    expect(sendChunkedReply).not.toHaveBeenCalled();
  });

  it('names the privacy state (not "_Not set_") on a stale expand of a redacted character', async () => {
    const character = createTestCharacter({ definitionRedacted: true, characterInfo: '' });
    stub.getPersonality.mockResolvedValue(makeOk({ personality: character }));

    await handleExpandField(expandInteraction(), 'test-character', 'characterInfo', config);

    expect(editReply).toHaveBeenCalledWith(expect.stringContaining('definition is private'));
    expect(sendChunkedReply).not.toHaveBeenCalled();
  });

  it('shows a generic error when the fetch fails with a non-404 status', async () => {
    stub.getPersonality.mockResolvedValue(makeErr(500, 'boom'));

    await handleExpandField(expandInteraction(), 'test-character', 'characterInfo', config);

    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('boom'),
    });
    expect(sendChunkedReply).not.toHaveBeenCalled();
  });
});
