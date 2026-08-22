import { describe, it, expect } from 'vitest';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import type { StoredReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import {
  collectPersonalityNames,
  formatConversationHistoryAsXml,
  formatSingleHistoryEntryAsXml,
} from './conversationUtils.js';
import { measureHistoryEntryTokens } from './historyTokenMeasure.js';
import type { StructuredHistoryEntry } from './conversationTypes.js';

const PERSONALITY = 'Lilith';

function userEntry(overrides: Partial<StructuredHistoryEntry> = {}): StructuredHistoryEntry {
  return {
    id: 'row-1',
    discordMessageId: ['1400000000000000001'],
    role: 'user',
    content: 'what did the whiteboard say',
    createdAt: '2026-07-20T12:00:00.000Z',
    personaId: 'persona-abc',
    personaName: 'Vlad',
    ...overrides,
  } satisfies StructuredHistoryEntry;
}

const QUOTE_DESCRIPTION =
  'A whiteboard covered in equations; the memory-reserve term is circled in red marker.';

function referenceWithImage(): StoredReferencedMessage {
  return {
    discordMessageId: '1399000000000000001',
    authorUsername: 'quoted_user',
    authorDisplayName: 'Quoted User',
    authorDiscordId: '900000000000000001',
    authorRole: 'user',
    content: 'check this out',
    timestamp: '2026-07-20T11:00:00.000Z',
    locationContext: 'in #general on Tzurot Test Server',
    attachments: [
      {
        id: 'att-1',
        url: 'https://cdn.discordapp.com/attachments/1/2/photo.png',
        contentType: 'image/png',
        name: 'photo.png',
      },
    ],
    attachmentEnrichment: [
      {
        url: 'https://cdn.discordapp.com/attachments/1/2/photo.png',
        kind: 'image',
        description: QUOTE_DESCRIPTION,
      },
    ],
  };
}

describe('measureHistoryEntryTokens', () => {
  it('returns the token count of exactly what the prompt renderer emits', () => {
    const entry = userEntry();
    const rendered = formatSingleHistoryEntryAsXml(entry, PERSONALITY);

    expect(measureHistoryEntryTokens(entry, PERSONALITY)).toBe(countTextTokens(rendered));
  });

  it('returns 0 for an entry the renderer declines to emit', () => {
    // Only 'user' and 'assistant' resolve to a speaker; anything else renders ''.
    const unresolvable = userEntry({ role: 'system' });
    expect(formatSingleHistoryEntryAsXml(unresolvable, PERSONALITY)).toBe('');
    expect(measureHistoryEntryTokens(unresolvable, PERSONALITY)).toBe(0);
  });

  describe('what the cached DB tokenCount misses', () => {
    it('counts the XML envelope on a plain-text entry', () => {
      const entry = userEntry();
      const cached = countTextTokens(entry.content);

      // The envelope (from/from_id/role/t attributes) is comparable in size to
      // a short Discord message, so the gap is large even with no metadata.
      expect(measureHistoryEntryTokens(entry, PERSONALITY)).toBeGreaterThan(cached * 2);
    });

    it('counts a quoted reference and its persisted image description', () => {
      const bare = userEntry();
      const withQuote = userEntry({
        messageMetadata: { referencedMessages: [referenceWithImage()] },
      });

      const measured = measureHistoryEntryTokens(withQuote, PERSONALITY);

      // The description is the largest single term a quote contributes, and the
      // one an entry's cached tokenCount can never carry.
      expect(measured).toBeGreaterThan(
        measureHistoryEntryTokens(bare, PERSONALITY) + countTextTokens(QUOTE_DESCRIPTION)
      );
    });

    // Typed rather than `as const`: the metadata has to stay mutable to assign
    // to messageMetadata, and typing it here means the compiler breaks this
    // table if the metadata shape moves.
    const metadataCases: [string, NonNullable<StructuredHistoryEntry['messageMetadata']>][] = [
      [
        'image descriptions',
        {
          imageDescriptions: [
            { filename: 'screenshot.png', description: 'A terminal showing four red assertions.' },
          ],
        },
      ],
      ['embeds', { embedsXml: ['<embed><title>A linked article</title></embed>'] }],
      ['voice transcripts', { voiceTranscripts: ['meet me at seven by the fountain'] }],
      [
        'reactions',
        {
          reactions: [
            { emoji: '🔥', reactors: [{ personaId: 'persona-1', displayName: 'User One' }] },
          ],
        },
      ],
    ];

    it.each(metadataCases)('counts %s', (_label, metadata) => {
      const bare = userEntry();
      const withMetadata = userEntry({ messageMetadata: metadata });

      expect(measureHistoryEntryTokens(withMetadata, PERSONALITY)).toBeGreaterThan(
        measureHistoryEntryTokens(bare, PERSONALITY)
      );
    });
  });

  it('measures the full form, not the deduped one — selection has no shipped-id set yet', () => {
    const entry = userEntry({ messageMetadata: { referencedMessages: [referenceWithImage()] } });
    const dedupedRender = formatSingleHistoryEntryAsXml(
      entry,
      PERSONALITY,
      new Map([['1399000000000000001', { role: 'user', content: '' }]])
    );

    // Pinning WHICH form gets measured. The two differ, so this would catch a
    // caller threading a dedup set in — which it cannot honestly have at
    // selection time. The sign of the difference is deliberately not asserted:
    // a deduped stub drops its content but keeps its media, so it can land on
    // either side of the full form.
    expect(measureHistoryEntryTokens(entry, PERSONALITY)).toBe(
      countTextTokens(formatSingleHistoryEntryAsXml(entry, PERSONALITY))
    );
    expect(countTextTokens(dedupedRender)).not.toBe(measureHistoryEntryTokens(entry, PERSONALITY));
  });

  describe('sibling-personality disambiguation', () => {
    // A user persona sharing its name with ANOTHER personality that spoke in the
    // same history gets a ` (@username)` suffix in the shipped XML. That suffix
    // is only reachable through allPersonalityNames, so a measurement without
    // the set under-counts exactly the entry the renderer widens.
    const history: StructuredHistoryEntry[] = [
      {
        id: 'row-a',
        discordMessageId: ['1400000000000000010'],
        role: 'assistant',
        content: 'a sibling personality speaks here',
        createdAt: '2026-07-20T11:59:00.000Z',
        personalityName: 'Morgana',
      },
      userEntry({
        personaName: 'Morgana',
        discordUsername: 'vlad_c',
        content: 'and a user happens to share its name',
      }),
    ];

    it('counts the disambiguation suffix when the sibling set is supplied', () => {
      const names = collectPersonalityNames(history, PERSONALITY);
      const collidingEntry = history[1];

      expect(measureHistoryEntryTokens(collidingEntry, PERSONALITY, names)).toBeGreaterThan(
        measureHistoryEntryTokens(collidingEntry, PERSONALITY)
      );
    });

    it('matches what the assembled chat log actually ships', () => {
      // The invariant, end to end: summing the per-entry measurement over the
      // history must not undershoot the real render of that same history.
      const names = collectPersonalityNames(history, PERSONALITY);
      const measured = history.reduce(
        (sum, entry) => sum + measureHistoryEntryTokens(entry, PERSONALITY, names),
        0
      );
      const shipped = countTextTokens(formatConversationHistoryAsXml(history, PERSONALITY));

      expect(measured).toBeGreaterThanOrEqual(shipped);
    });
  });
});
