/**
 * Tests for CrossChannelSerializer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { serializeCrossChannelHistory } from './CrossChannelSerializer.js';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { type CrossChannelHistoryGroupEntry } from '@tzurot/common-types/types/schemas/message';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import type { StructuredHistoryEntry } from '../../jobs/utils/conversationTypes.js';
import { getPriorConversationsWrapperOverheadText } from '../../jobs/utils/conversationUtils.js';
import type { RealRenderSettings } from './RealMessagesBuilder.js';

/** Builds a {@link RealRenderSettings} for a test call site — only
 *  `realMessagesEnabled` and `timezone` vary across these tests;
 *  `headerSpoofNeutralizeEnabled`/`headerIdTags` are unused by cross-channel
 *  serialization but required by the interface. */
function render(realMessagesEnabled: boolean, timezone?: string): RealRenderSettings {
  return {
    realMessagesEnabled,
    headerSpoofNeutralizeEnabled: false,
    headerIdTags: new Map(),
    timezone,
  };
}

// Mock logger
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

function createGroup(
  overrides: Partial<CrossChannelHistoryGroupEntry> = {}
): CrossChannelHistoryGroupEntry {
  return {
    channelEnvironment: {
      type: 'guild',
      guild: { id: 'guild-1', name: 'Test Server' },
      channel: { id: 'channel-1', name: 'general', type: 'text' },
    },
    messages: [
      {
        id: 'msg-1',
        role: MessageRole.User,
        content: 'Hello from another channel',
        createdAt: '2026-02-26T10:00:00Z',
        personaName: 'TestUser',
        tokenCount: 10,
      },
      {
        id: 'msg-2',
        role: MessageRole.Assistant,
        content: 'Hi there!',
        createdAt: '2026-02-26T10:01:00Z',
        tokenCount: 5,
      },
    ],
    ...overrides,
  };
}

describe('serializeCrossChannelHistory', () => {
  describe('responder identity by id', () => {
    /** A group whose assistant row is the responder's own, stamped with a PRE-RENAME name. */
    function renamedResponderGroup(): CrossChannelHistoryGroupEntry {
      return createGroup({
        messages: [
          {
            id: 'msg-old',
            role: MessageRole.Assistant,
            content: 'Said this before the rename.',
            createdAt: '2026-02-26T10:00:00Z',
            tokenCount: 8,
            personalityId: 'p-self',
            personalityName: 'OldName',
          },
        ],
      });
    }

    // No timer hooks here: the enclosing describe already installs fake timers
    // per test and follows the repo's documented useFakeTimers/restoreAllMocks
    // pairing. Re-declaring them locally deviated from that for no gain.
    it("renders the responder's own pre-rename rows as assistant when the id is supplied", () => {
      const result = serializeCrossChannelHistory(
        [renamedResponderGroup()],
        'BrandNewName',
        5000,
        'p-self',
        render(false)
      );

      expect(result.xml).toContain('role="assistant"');
      expect(result.xml).not.toContain('role="character"');
    });

    it('falls back to the name comparison when no responder id is supplied', () => {
      // Pins the fallback rather than asserting it is desirable: this is the
      // pre-fix behaviour, and it is what an id-less row still gets.
      const result = serializeCrossChannelHistory(
        [renamedResponderGroup()],
        'BrandNewName',
        5000,
        undefined,
        render(false)
      );

      expect(result.xml).toContain('role="character"');
    });
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty for empty groups', () => {
    const result = serializeCrossChannelHistory([], 'TestAI', 1000, undefined, render(false));
    expect(result.xml).toBe('');
    expect(result.messagesIncluded).toBe(0);
  });

  it('should return empty when budget is 0', () => {
    const result = serializeCrossChannelHistory(
      [createGroup()],
      'TestAI',
      0,
      undefined,
      render(false)
    );
    expect(result.xml).toBe('');
    expect(result.messagesIncluded).toBe(0);
  });

  it('should return empty when budget is positive but less than wrapper overhead', () => {
    // Budget of 1 is positive (passes tokenBudget <= 0 check) but smaller than
    // the <prior_conversations> wrapper overhead, so availableBudget <= 0
    const result = serializeCrossChannelHistory(
      [createGroup()],
      'TestAI',
      1,
      undefined,
      render(false)
    );
    expect(result.xml).toBe('');
    expect(result.messagesIncluded).toBe(0);
  });

  it('should serialize a single group with location block', () => {
    const result = serializeCrossChannelHistory(
      [createGroup()],
      'TestAI',
      5000,
      undefined,
      render(false)
    );
    expect(result.xml).toContain('<prior_conversations>');
    expect(result.xml).toContain('</prior_conversations>');
    expect(result.xml).toContain('<channel_history>');
    expect(result.xml).toContain('</channel_history>');
    expect(result.xml).toContain('<location type="guild" scope="prior">');
    expect(result.xml).toContain('<server name="Test Server"/>');
    expect(result.xml).toContain('<channel name="general" type="text"/>');
    expect(result.xml).toContain('Hello from another channel');
    expect(result.messagesIncluded).toBe(2);
  });

  it('renders the threaded timezone, not the New York fallback', () => {
    // The fixture instant below is 05:00 in the APP_SETTINGS.TIMEZONE fallback
    // (America/New_York, winter — no DST) and 19:00 in the threaded zone
    // (Asia/Tokyo), so a dropped `render` argument renders the wrong hour.
    const group = createGroup({
      messages: [
        {
          id: 'msg-1',
          role: MessageRole.User,
          content: 'Cross-channel message at a zone-sensitive hour',
          createdAt: '2026-02-26T10:00:00Z',
          personaName: 'TestUser',
          tokenCount: 10,
        },
      ],
    });

    const result = serializeCrossChannelHistory(
      [group],
      'TestAI',
      5000,
      undefined,
      render(false, 'Asia/Tokyo')
    );

    expect(result.xml).toContain('t="');
    expect(result.xml).toMatch(/t="[^"]*19:00[^"]*"/);
    expect(result.xml).not.toMatch(/t="[^"]*05:00[^"]*"/);
  });

  it('should serialize DM groups correctly', () => {
    const dmGroup = createGroup({
      channelEnvironment: {
        type: 'dm',
        channel: { id: 'dm-1', name: 'Direct Message', type: 'dm' },
      },
    });

    const result = serializeCrossChannelHistory(
      [dmGroup],
      'TestAI',
      5000,
      undefined,
      render(false)
    );
    expect(result.xml).toContain('<location type="dm" scope="prior">');
    expect(result.xml).toContain('Direct Message');
  });

  it('every rendered <location> carries scope="prior" (estimate/render agreement)', () => {
    const guildGroup = createGroup();
    const dmGroup = createGroup({
      channelEnvironment: {
        type: 'dm',
        channel: { id: 'dm-1', name: 'Direct Message', type: 'dm' },
      },
    });

    const result = serializeCrossChannelHistory(
      [guildGroup, dmGroup],
      'TestAI',
      5000,
      undefined,
      render(false)
    );

    // Exclude the static `<location>` mention inside the <instruction> text
    // itself — only the per-channel location BLOCKS carry scope="prior".
    const channelHistoryBlocks =
      result.xml.match(/<channel_history>[\s\S]*?<\/channel_history>/g) ?? [];
    const locationOpenTags = channelHistoryBlocks.flatMap(
      block => block.match(/<location[^>]*>/g) ?? []
    );
    expect(locationOpenTags.length).toBe(2);
    for (const tag of locationOpenTags) {
      expect(tag).toContain('scope="prior"');
    }
  });

  it('accounts for the instruction text in the wrapper-overhead budget check', () => {
    const bareTagsOverhead = countTextTokens('<prior_conversations>\n</prior_conversations>');
    const instructionBearingOverhead = countTextTokens(getPriorConversationsWrapperOverheadText());

    // A budget between the two: too small for the real (instruction-bearing)
    // wrapper, but would have looked sufficient against the old bare-tags
    // measurement. If the budget check under-counts, this slips through and
    // renders content; it must not.
    const budget = bareTagsOverhead + 1;
    expect(budget).toBeLessThan(instructionBearingOverhead);

    const result = serializeCrossChannelHistory(
      [createGroup()],
      'TestAI',
      budget,
      undefined,
      render(false)
    );

    expect(result).toEqual({ xml: '', messagesIncluded: 0 });
  });

  it('should use recency strategy: keep newest messages when budget is tight', () => {
    // Sizes are driven by real content, not a hand-set tokenCount: selection
    // measures the rendered entry, so a fixture whose declared count disagrees
    // with its content would test nothing.
    const padding = 'padding words to make this message cost real tokens '.repeat(3);
    const group = createGroup({
      messages: [
        { id: 'msg-1', role: MessageRole.User, content: `Oldest message ${padding}` },
        { id: 'msg-2', role: MessageRole.Assistant, content: `Second message ${padding}` },
        { id: 'msg-3', role: MessageRole.User, content: `Third message ${padding}` },
        { id: 'msg-4', role: MessageRole.Assistant, content: `Newest message ${padding}` },
      ],
    });

    // Budget fits ~2 messages plus overhead, not all 4. The overhead it must
    // clear includes the <prior_conversations> instruction text; the guard
    // below fails loudly if the instruction ever outgrows this fixture, so
    // the constant can't silently stop meaning "fits two".
    const budget = 220;
    expect(budget).toBeGreaterThan(countTextTokens(getPriorConversationsWrapperOverheadText()));
    const result = serializeCrossChannelHistory(
      [group],
      'TestAI',
      budget,
      undefined,
      render(false)
    );
    // Recency: should keep newest (msg-4, msg-3), drop oldest (msg-1, msg-2)
    expect(result.xml).toContain('Newest message');
    expect(result.xml).toContain('Third message');
    expect(result.xml).not.toContain('Oldest message');
    expect(result.xml).not.toContain('Second message');
    expect(result.messagesIncluded).toBe(2);
  });

  it('should skip entire group when newest message exceeds budget (contiguous tail)', () => {
    const group = createGroup({
      messages: [
        { id: 'msg-1', role: MessageRole.User, content: 'Short', tokenCount: 5 },
        { id: 'msg-2', role: MessageRole.Assistant, content: 'Also short', tokenCount: 5 },
        {
          id: 'msg-3',
          role: MessageRole.User,
          content: 'This is a very long message '.repeat(50),
          tokenCount: 500,
        },
      ],
    });

    // Budget can't fit msg-3 (newest), so contiguous-tail strategy skips entire group
    const result = serializeCrossChannelHistory([group], 'TestAI', 200, undefined, render(false));
    expect(result.xml).toBe('');
    expect(result.messagesIncluded).toBe(0);
  });

  it('should return empty when budget is too tight for any messages', () => {
    const group = createGroup({
      messages: [{ id: 'msg-1', role: MessageRole.User, content: 'Hello world', tokenCount: 100 }],
    });

    // Budget of 5 is too small for even the wrapper overhead + location block + one message
    const result = serializeCrossChannelHistory([group], 'TestAI', 5, undefined, render(false));
    expect(result.xml).toBe('');
    expect(result.messagesIncluded).toBe(0);
  });

  it('should skip group that does not fit but continue to later groups', () => {
    // Group 1: large messages that don't fit → skipped
    const expensiveGroup = createGroup({
      channelEnvironment: {
        type: 'guild',
        guild: { id: 'guild-1', name: 'Test Server' },
        channel: { id: 'channel-1', name: 'expensive', type: 'text' },
      },
      messages: [
        {
          id: 'msg-1',
          role: MessageRole.User,
          content: `Huge message ${'that goes on and on at length '.repeat(30)}`,
        },
      ],
    });
    // Group 2: small messages that would fit if budget were available
    const cheapGroup = createGroup({
      channelEnvironment: {
        type: 'guild',
        guild: { id: 'guild-1', name: 'Test Server' },
        channel: { id: 'channel-2', name: 'cheap', type: 'text' },
      },
      messages: [{ id: 'msg-2', role: MessageRole.User, content: 'Tiny', tokenCount: 5 }],
    });

    // Budget fits cheap group but not expensive group.
    // Group 1 (expensive) is skipped, group 2 (cheap) still gets included since
    // the loop continues to lower-priority groups when budget remains.
    const result = serializeCrossChannelHistory(
      [expensiveGroup, cheapGroup],
      'TestAI',
      150,
      undefined,
      render(false)
    );
    expect(result.xml).not.toContain('expensive');
    expect(result.xml).toContain('cheap');
    expect(result.xml).toContain('Tiny');
    expect(result.messagesIncluded).toBe(1);
  });

  it('should serialize multiple groups', () => {
    const group1 = createGroup();
    const group2 = createGroup({
      channelEnvironment: {
        type: 'guild',
        guild: { id: 'guild-1', name: 'Test Server' },
        channel: { id: 'channel-2', name: 'random', type: 'text' },
      },
      messages: [
        {
          id: 'msg-3',
          role: MessageRole.User,
          content: 'In the random channel',
          tokenCount: 8,
        },
      ],
    });

    const result = serializeCrossChannelHistory(
      [group1, group2],
      'TestAI',
      5000,
      undefined,
      render(false)
    );
    expect(result.xml).toContain('general');
    expect(result.xml).toContain('random');
    expect(result.xml).toContain('In the random channel');
    expect(result.messagesIncluded).toBe(3);
  });

  describe('deduped reference wording (TASK-726 rider — no prior pin existed)', () => {
    // Dedup is ID-derived, not a flag: a group whose second message quotes a
    // Discord id ALREADY carried by an earlier message in the SAME group.
    //
    // `discordMessageId` and `messageMetadata` are NOT in `crossChannelMessageSchema`
    // (verified: `packages/common-types/src/types/schemas/message.ts`'s
    // `crossChannelMessageSchema` carries neither field) — the wire contract for
    // a cross-channel message is narrower than `StructuredHistoryEntry`. The
    // renderer this test exercises (`formatConversationHistoryAsXml`, called
    // per-group by `formatCrossChannelHistoryAsXml`) reads both fields
    // dynamically regardless of that narrower declared type, so the cast below
    // exercises real behaviour rather than fabricating an unreachable shape —
    // but it does mean today's TYPE SYSTEM cannot express a cross-channel quote
    // dedup at all, only the runtime renderer can. Flagged rather than silently
    // worked around.
    function groupWithDedupedReference(): CrossChannelHistoryGroupEntry {
      const quotedId = 'msg-quoted-1';
      const messages: StructuredHistoryEntry[] = [
        {
          id: 'msg-1',
          role: MessageRole.User,
          content: 'the original message',
          createdAt: '2026-02-26T10:00:00Z',
          personaName: 'Bob',
          discordMessageId: [quotedId],
          tokenCount: 10,
        },
        {
          id: 'msg-2',
          role: MessageRole.User,
          content: 'replying to it',
          createdAt: '2026-02-26T10:01:00Z',
          personaName: 'Alice',
          tokenCount: 10,
          messageMetadata: {
            referencedMessages: [
              {
                discordMessageId: quotedId,
                authorUsername: 'bob',
                authorDisplayName: 'Bob',
                content: 'the original message',
                timestamp: '2026-02-26T10:00:00Z',
                locationContext: '#general',
              },
            ],
          },
        },
      ];
      return createGroup({
        messages: messages as unknown as CrossChannelHistoryGroupEntry['messages'],
      });
    }

    it('flag-on: dedups to the real-messages stub wording, not the chat_log phrasing', () => {
      const result = serializeCrossChannelHistory(
        [groupWithDedupedReference()],
        'TestAI',
        5000,
        undefined,
        render(true)
      );

      expect(result.xml).toContain('appears earlier in the conversation');
      expect(result.xml).not.toContain('in the chat log');
    });

    it('flag-off: dedups to the chat_log phrasing, not the real-messages stub wording', () => {
      const result = serializeCrossChannelHistory(
        [groupWithDedupedReference()],
        'TestAI',
        5000,
        undefined,
        render(false)
      );

      expect(result.xml).toContain('in the chat log');
      expect(result.xml).not.toContain('appears earlier in the conversation');
    });
  });

  describe('budget spends newest-channel-first (array arrives oldest-first)', () => {
    /** A named channel group with two distinctly-content-tagged messages. */
    function namedGroup(
      channelId: string,
      tagA: string,
      tagB: string
    ): CrossChannelHistoryGroupEntry {
      return createGroup({
        channelEnvironment: {
          type: 'guild',
          guild: { id: 'guild-1', name: 'Test Server' },
          channel: { id: channelId, name: channelId, type: 'text' },
        },
        messages: [
          { id: `${tagA}-id`, role: MessageRole.User, content: tagA },
          { id: `${tagB}-id`, role: MessageRole.Assistant, content: tagB },
        ],
      });
    }

    // Producer order: oldest channel first, newest channel last.
    const g1 = namedGroup('ch-g1', 'g1-a', 'g1-b');
    const g2 = namedGroup('ch-g2', 'g2-a', 'g2-b');
    const g3 = namedGroup('ch-g3', 'g3-a', 'g3-b');

    /** Binary-searches the minimal integer budget at which `messagesIncluded`
     *  reaches `target` against production serialization — avoids hand-derived
     *  token-count constants that would drift with the tokenizer or renderer. */
    function minimalBudgetFor(
      groups: CrossChannelHistoryGroupEntry[],
      target: number,
      hi = 4000
    ): number {
      let lo = 0;
      let upper = hi;
      while (lo < upper) {
        const mid = Math.floor((lo + upper) / 2);
        const { messagesIncluded } = serializeCrossChannelHistory(
          groups,
          'TestAI',
          mid,
          undefined,
          render(false)
        );
        if (messagesIncluded >= target) {
          upper = mid;
        } else {
          lo = mid + 1;
        }
      }
      return lo;
    }

    it('funds the newest two channels and drops the oldest, preserving array (chronological) order in the output', () => {
      const budgetForTwoNewest = minimalBudgetFor([g2, g3], 4);
      // Sanity: the same budget against all three groups still yields exactly
      // the two newest — it must not accidentally also admit part of g1.
      const cut = serializeCrossChannelHistory(
        [g1, g2, g3],
        'TestAI',
        budgetForTwoNewest,
        undefined,
        render(false)
      );

      expect(cut.messagesIncluded).toBe(4);
      expect(cut.xml).toContain('g2-a');
      expect(cut.xml).toContain('g3-a');
      expect(cut.xml).not.toContain('g1-a');
      expect(cut.xml.indexOf('g2-a')).toBeLessThan(cut.xml.indexOf('g3-a'));

      // A larger budget admits the oldest (third) channel too.
      const budgetForAllThree = minimalBudgetFor([g1, g2, g3], 6);
      expect(budgetForAllThree).toBeGreaterThan(budgetForTwoNewest);
      const full = serializeCrossChannelHistory(
        [g1, g2, g3],
        'TestAI',
        budgetForAllThree,
        undefined,
        render(false)
      );
      expect(full.messagesIncluded).toBe(6);
      expect(full.xml).toContain('g1-a');
    });

    it('counts only the rows it is given: a single pre-filtered group with two user rows yields messagesIncluded=2', () => {
      const preFiltered = createGroup({
        messages: [
          { id: 'uo-a', role: MessageRole.User, content: 'user row a' },
          { id: 'uo-b', role: MessageRole.User, content: 'user row b' },
        ],
      });

      const result = serializeCrossChannelHistory(
        [preFiltered],
        'TestAI',
        5000,
        undefined,
        render(false)
      );

      expect(result.messagesIncluded).toBe(2);
    });
  });
});
