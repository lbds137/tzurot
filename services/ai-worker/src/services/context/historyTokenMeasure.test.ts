import { describe, it, expect } from 'vitest';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import type { StoredReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import {
  collectPersonalityNames,
  formatConversationHistoryAsXml,
  formatSingleHistoryEntryAsXml,
} from '../../jobs/utils/conversationUtils.js';
import {
  measureHistoryEntryTokens,
  measureHistoryEntryRealTokens,
  PER_MESSAGE_WIRE_OVERHEAD_TOKENS,
} from './historyTokenMeasure.js';
import { renderHistoryEntryForMeasure, buildRealMessages } from './RealMessagesBuilder.js';
import type { StructuredHistoryEntry } from '../../jobs/utils/conversationTypes.js';

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
    const rendered = formatSingleHistoryEntryAsXml(entry, PERSONALITY, {
      realMessagesEnabled: false,
    });

    expect(measureHistoryEntryTokens(entry, PERSONALITY, undefined, undefined, false)).toBe(
      countTextTokens(rendered)
    );
  });

  it('returns 0 for an entry the renderer declines to emit', () => {
    // Only 'user' and 'assistant' resolve to a speaker; anything else renders ''.
    const unresolvable = userEntry({ role: 'system' });
    expect(
      formatSingleHistoryEntryAsXml(unresolvable, PERSONALITY, { realMessagesEnabled: false })
    ).toBe('');
    expect(measureHistoryEntryTokens(unresolvable, PERSONALITY, undefined, undefined, false)).toBe(
      0
    );
  });

  describe('what the cached DB tokenCount misses', () => {
    it('counts the XML envelope on a plain-text entry', () => {
      const entry = userEntry();
      const cached = countTextTokens(entry.content);

      // The envelope (from/from_id/role/t attributes) is comparable in size to
      // a short Discord message, so the gap is large even with no metadata.
      expect(
        measureHistoryEntryTokens(entry, PERSONALITY, undefined, undefined, false)
      ).toBeGreaterThan(cached * 2);
    });

    it('counts a quoted reference and its persisted image description', () => {
      const bare = userEntry();
      const withQuote = userEntry({
        messageMetadata: { referencedMessages: [referenceWithImage()] },
      });

      const measured = measureHistoryEntryTokens(
        withQuote,
        PERSONALITY,
        undefined,
        undefined,
        false
      );

      // The description is the largest single term a quote contributes, and the
      // one an entry's cached tokenCount can never carry.
      expect(measured).toBeGreaterThan(
        measureHistoryEntryTokens(bare, PERSONALITY, undefined, undefined, false) +
          countTextTokens(QUOTE_DESCRIPTION)
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

      expect(
        measureHistoryEntryTokens(withMetadata, PERSONALITY, undefined, undefined, false)
      ).toBeGreaterThan(measureHistoryEntryTokens(bare, PERSONALITY, undefined, undefined, false));
    });
  });

  it('measures the full form, not the deduped one — selection has no shipped-id set yet', () => {
    const entry = userEntry({ messageMetadata: { referencedMessages: [referenceWithImage()] } });
    const dedupedRender = formatSingleHistoryEntryAsXml(entry, PERSONALITY, {
      historyEntries: new Map([['1399000000000000001', { role: 'user', content: '' }]]),
      realMessagesEnabled: false,
    });

    // Pinning WHICH form gets measured. The two differ, so this would catch a
    // caller threading a dedup set in — which it cannot honestly have at
    // selection time. The sign of the difference is deliberately not asserted:
    // a deduped stub drops its content but keeps its media, so it can land on
    // either side of the full form.
    expect(measureHistoryEntryTokens(entry, PERSONALITY, undefined, undefined, false)).toBe(
      countTextTokens(
        formatSingleHistoryEntryAsXml(entry, PERSONALITY, { realMessagesEnabled: false })
      )
    );
    expect(countTextTokens(dedupedRender)).not.toBe(
      measureHistoryEntryTokens(entry, PERSONALITY, undefined, undefined, false)
    );
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

      expect(
        measureHistoryEntryTokens(collidingEntry, PERSONALITY, names, undefined, false)
      ).toBeGreaterThan(
        measureHistoryEntryTokens(collidingEntry, PERSONALITY, undefined, undefined, false)
      );
    });

    it('matches what the assembled chat log actually ships', () => {
      // The invariant, end to end: summing the per-entry measurement over the
      // history must not undershoot the real render of that same history.
      const names = collectPersonalityNames(history, PERSONALITY);
      const measured = history.reduce(
        (sum, entry) =>
          sum + measureHistoryEntryTokens(entry, PERSONALITY, names, undefined, false),
        0
      );
      const shipped = countTextTokens(formatConversationHistoryAsXml(history, PERSONALITY));

      expect(measured).toBeGreaterThanOrEqual(shipped);
    });
  });
});

describe('measureHistoryEntryRealTokens', () => {
  const NO_TAGS = new Map<string, string>();

  function opts(overrides: Partial<Parameters<typeof measureHistoryEntryRealTokens>[1]> = {}) {
    return {
      personalityName: PERSONALITY,
      allPersonalityNames: undefined,
      responderPersonalityId: undefined,
      realMessagesEnabled: true,
      headerSpoofNeutralizeEnabled: false,
      headerIdTags: NO_TAGS,
      ...overrides,
    };
  }

  it('returns 0 for a row the real-message render has no speaker for', () => {
    const entry = { role: 'system', content: 'ignored' } as StructuredHistoryEntry;

    expect(measureHistoryEntryRealTokens(entry, opts())).toBe(0);
  });

  it('returns 0 for an assistant row whose body renders empty', () => {
    // The real path skips this row rather than shipping an empty-content
    // message, so the measure must agree — a nonzero cost here would price
    // a message the prompt never carries.
    const entry = {
      role: 'assistant',
      content: '',
      personalityName: PERSONALITY,
    } as StructuredHistoryEntry;

    expect(measureHistoryEntryRealTokens(entry, opts())).toBe(0);
  });

  it('charges the rendered content plus the worst-case gap line and the wire overhead', () => {
    // Pinned against independently-written literals rather than the module's
    // own constants: an assertion phrased in terms of
    // PER_MESSAGE_WIRE_OVERHEAD_TOKENS moves WITH that constant, so it cannot
    // fail if the constant is wrong. The gap-line string is the one the
    // measure charges to EVERY entry — a per-entry measure cannot know whether
    // this entry's neighbour puts it past the gap threshold, so it always
    // charges the widest form. No header id-tag term here: with an EMPTY map
    // (no collisions), the measure charges nothing extra for tagging — see the
    // "colliding-measure" test below for the case where it does.
    const entry = userEntry();
    const rendered = renderHistoryEntryForMeasure(entry, opts({ realMessagesEnabled: false }));
    const worstCaseGapTokens = countTextTokens('[time gap: 52 weeks 6 days]\n');

    const measured = measureHistoryEntryRealTokens(entry, opts());

    expect(rendered.length).toBeGreaterThan(0);
    expect(measured).toBe(countTextTokens(rendered) + worstCaseGapTokens + 4);
    // The constant is what the measure actually spends; pinned separately so a
    // change to it is a deliberate edit here, not silent drift.
    expect(PER_MESSAGE_WIRE_OVERHEAD_TOKENS).toBe(4);
  });

  it('is deterministic for the same entry', () => {
    const entry = userEntry();

    expect(measureHistoryEntryRealTokens(entry, opts())).toBe(
      measureHistoryEntryRealTokens(entry, opts())
    );
  });

  it('stays under the XML measure for the same entry', () => {
    // The recalibration's whole point: the XML envelope costs more than a
    // header line, so the flag-on budget stops reserving headroom the real
    // form never spends. A non-colliding fixture (empty map), so no header
    // id-tag bytes enter either side of this comparison.
    const entry = userEntry();

    expect(measureHistoryEntryRealTokens(entry, opts())).toBeLessThan(
      measureHistoryEntryTokens(entry, PERSONALITY, undefined, undefined, false)
    );
  });

  describe('header id-tag charging (TASK-726 revision: threaded, not worst-cased)', () => {
    // The map is window-level and depends only on this entry's own speaker
    // id, so — unlike the gap line — the measure can know EXACTLY whether
    // this entry pays a tag, and charges precisely that cost rather than a
    // worst case.
    const COLLIDING_ID = 'a1b2c3d4-0000-0000-0000-000000000001';

    function collidingEntry(): StructuredHistoryEntry {
      return userEntry({ personaId: COLLIDING_ID, personaName: 'Vlad' });
    }

    it('charges exactly the tag-cost delta between a colliding map and an empty one', () => {
      const entry = collidingEntry();
      const taggedMap = new Map([[COLLIDING_ID, 'a1b2']]);

      const withTag = measureHistoryEntryRealTokens(entry, opts({ headerIdTags: taggedMap }));
      const withoutTag = measureHistoryEntryRealTokens(entry, opts({ headerIdTags: NO_TAGS }));

      // Derived from the two RENDERED forms, never a hand-written token
      // count: the delta is whatever the renderer actually produces for the
      // tag, so this cannot silently drift from the real cost.
      const taggedRender = renderHistoryEntryForMeasure(
        entry,
        opts({ headerIdTags: taggedMap, realMessagesEnabled: false })
      );
      const untaggedRender = renderHistoryEntryForMeasure(
        entry,
        opts({ headerIdTags: NO_TAGS, realMessagesEnabled: false })
      );
      const expectedDelta = countTextTokens(taggedRender) - countTextTokens(untaggedRender);

      expect(expectedDelta).toBeGreaterThan(0);
      expect(withTag - withoutTag).toBe(expectedDelta);
    });

    it('no-drift seam: renderHistoryEntryForMeasure produces the SAME header line buildRealMessages would, for the same entry and map', () => {
      const entry = collidingEntry();
      const taggedMap = new Map([[COLLIDING_ID, 'a1b2']]);

      const measureRender = renderHistoryEntryForMeasure(
        entry,
        opts({ headerIdTags: taggedMap, realMessagesEnabled: true })
      );
      const [shipped] = buildRealMessages([entry], {
        personalityName: PERSONALITY,
        responderPersonalityId: undefined,
        realMessagesEnabled: true,
        headerSpoofNeutralizeEnabled: false,
        headerIdTags: taggedMap,
      });
      const shippedContent = String(shipped.content);

      const measureHeaderLine = measureRender.split('\n')[0];
      const shippedHeaderLine = shippedContent.split('\n')[0];

      expect(measureHeaderLine).toContain('(id:a1b2)');
      expect(measureHeaderLine).toBe(shippedHeaderLine);
    });
  });
});
