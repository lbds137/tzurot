import { describe, it, expect, beforeEach } from 'vitest';
import { ContextWindowManager, computeEvictionCut } from './ContextWindowManager.js';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { type DiscordEnvironment } from '@tzurot/common-types/types/schemas/discord';
import {
  measureHistoryEntryTokens,
  measureHistoryEntryRealTokens,
  PER_MESSAGE_WIRE_OVERHEAD_TOKENS,
} from './historyTokenMeasure.js';
import { buildRealMessages } from './RealMessagesBuilder.js';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import { getPriorConversationsWrapperOverheadText } from '../../jobs/utils/conversationUtils.js';
import type { StructuredHistoryEntry } from '../../jobs/utils/conversationUtils.js';

describe('ContextWindowManager', () => {
  let manager: ContextWindowManager;

  beforeEach(() => {
    manager = new ContextWindowManager();
  });

  describe('selectAndSerializeHistory', () => {
    it('should serialize current channel history as XML', () => {
      const rawHistory = [
        { role: 'user', content: 'Hello', createdAt: '2026-02-26T10:00:00Z', tokenCount: 5 },
        {
          role: 'assistant',
          content: 'Hi there!',
          createdAt: '2026-02-26T10:01:00Z',
          tokenCount: 5,
        },
      ];

      const result = manager.selectAndSerializeHistory(rawHistory, { name: 'TestAI' }, 1000, {
        headerIdTags: new Map(),
      });

      expect(result.serializedHistory).toContain('Hello');
      expect(result.serializedHistory).toContain('Hi there!');
      expect(result.messagesIncluded).toBe(2);
      expect(result.messagesDropped).toBe(0);
      expect(result.historyTokensUsed).toBeGreaterThan(0);
    });

    it('should return empty when history is undefined', () => {
      const result = manager.selectAndSerializeHistory(undefined, { name: 'TestAI' }, 1000, {
        headerIdTags: new Map(),
      });

      expect(result.serializedHistory).toBe('');
      expect(result.messagesIncluded).toBe(0);
    });

    it('should return empty when budget is 0', () => {
      const rawHistory = [
        { role: 'user', content: 'Hello', createdAt: '2026-02-26T10:00:00Z', tokenCount: 5 },
      ];

      const result = manager.selectAndSerializeHistory(rawHistory, { name: 'TestAI' }, 0, {
        headerIdTags: new Map(),
      });

      expect(result.serializedHistory).toBe('');
      expect(result.messagesDropped).toBe(1);
    });

    it('should return empty when budget is 0 even with both current and cross-channel history', () => {
      const rawHistory = [
        { role: 'user', content: 'Hi', createdAt: '2026-02-27T10:00:00Z', tokenCount: 5 },
      ];

      const crossChannelGroups = [
        {
          channelEnvironment: {
            type: 'guild' as const,
            guild: { id: 'g-1', name: 'Server' },
            channel: { id: 'ch-other', name: 'general', type: 'text' },
          },
          messages: [
            {
              role: MessageRole.User,
              content: 'Cross message',
              createdAt: '2026-02-26T10:00:00Z',
              tokenCount: 5,
            },
          ],
        },
      ];

      const result = manager.selectAndSerializeHistory(rawHistory, { name: 'TestAI' }, 0, {
        headerIdTags: new Map(),
        crossChannelGroups,
      });

      expect(result.serializedHistory).toBe('');
      expect(result.messagesDropped).toBe(1);
      expect(result.crossChannelMessagesIncluded).toBe(0);
    });

    it('should return empty current-channel when budget barely covers wrapper overhead', () => {
      const rawHistory = [
        { role: 'user', content: 'Hello', createdAt: '2026-02-26T10:00:00Z', tokenCount: 5 },
      ];

      // Budget of 2 is positive (passes the historyBudget <= 0 check) but smaller than
      // the <chat_log> wrapper overhead (~3+ tokens), so budgetAfterOverhead <= 0
      const result = manager.selectAndSerializeHistory(rawHistory, { name: 'TestAI' }, 2, {
        headerIdTags: new Map(),
      });

      expect(result.serializedHistory).toBe('');
      expect(result.messagesIncluded).toBe(0);
      expect(result.messagesDropped).toBe(1);
    });

    it('should include cross-channel history when provided and budget remains', () => {
      const rawHistory = [
        {
          role: 'user',
          content: 'Current channel msg',
          createdAt: '2026-02-27T10:00:00Z',
          tokenCount: 10,
        },
      ];

      const crossChannelGroups = [
        {
          channelEnvironment: {
            type: 'guild' as const,
            guild: { id: 'g-1', name: 'Server' },
            channel: { id: 'ch-other', name: 'general', type: 'text' },
          },
          messages: [
            {
              role: MessageRole.User,
              content: 'Cross-channel message',
              createdAt: '2026-02-26T10:00:00Z',
              personaName: 'TestUser',
              tokenCount: 10,
            },
          ],
        },
      ];

      const result = manager.selectAndSerializeHistory(rawHistory, { name: 'TestAI' }, 5000, {
        headerIdTags: new Map(),
        crossChannelGroups,
      });

      expect(result.serializedHistory).toContain('Current channel msg');
      expect(result.serializedHistory).toContain('Cross-channel message');
      expect(result.serializedHistory).toContain('<prior_conversations>');
      expect(result.historyTokensUsed).toBeGreaterThan(0);
      // The separated field (PR 2.3): the SAME cross-channel XML that
      // combineHistorySections folded into serializedHistory, standalone —
      // and never the current-channel content, which ships separately.
      expect(result.crossChannelXml).toContain('<prior_conversations>');
      expect(result.crossChannelXml).toContain('Cross-channel message');
      expect(result.crossChannelXml).not.toContain('Current channel msg');
      expect(result.serializedHistory).toContain(result.crossChannelXml);
    });

    it('should not include cross-channel history when budget is exhausted', () => {
      // Use a long message that consumes most of a tight budget
      const rawHistory = [
        {
          role: 'user',
          content: 'Hello there friend',
          createdAt: '2026-02-27T10:00:00Z',
          tokenCount: 5,
        },
      ];

      const crossChannelGroups = [
        {
          channelEnvironment: {
            type: 'dm' as const,
            channel: { id: 'dm-1', name: 'DM', type: 'dm' },
          },
          messages: [
            {
              role: MessageRole.User,
              content: 'DM message',
              createdAt: '2026-02-26T10:00:00Z',
              tokenCount: 500,
            },
          ],
        },
      ];

      // Budget that fits current channel but leaves no room for cross-channel (500 token message)
      const result = manager.selectAndSerializeHistory(rawHistory, { name: 'TestAI' }, 50, {
        headerIdTags: new Map(),
        crossChannelGroups,
      });

      expect(result.messagesIncluded).toBe(1);
      expect(result.serializedHistory).not.toContain('DM message');
    });

    it('should include cross-channel history even when rawHistory is empty (fresh channel)', () => {
      const crossChannelGroups = [
        {
          channelEnvironment: {
            type: 'guild' as const,
            guild: { id: 'g-1', name: 'Server' },
            channel: { id: 'ch-other', name: 'general', type: 'text' },
          },
          messages: [
            {
              role: MessageRole.User,
              content: 'Previous conversation in another channel',
              createdAt: '2026-02-26T10:00:00Z',
              personaName: 'TestUser',
              tokenCount: 15,
            },
          ],
        },
      ];

      // rawHistory is empty (first message in new channel), but cross-channel exists
      const result = manager.selectAndSerializeHistory([], { name: 'TestAI' }, 5000, {
        headerIdTags: new Map(),
        crossChannelGroups,
      });

      expect(result.serializedHistory).toContain('Previous conversation in another channel');
      expect(result.serializedHistory).toContain('<prior_conversations>');
      expect(result.historyTokensUsed).toBeGreaterThan(0);
      expect(result.messagesIncluded).toBe(0); // No current-channel messages
      expect(result.messagesDropped).toBe(0);
    });

    it('should not count wrapper overhead when no current-channel messages fit budget', () => {
      const crossChannelGroups = [
        {
          channelEnvironment: {
            type: 'dm' as const,
            channel: { id: 'dm-1', name: 'DM', type: 'dm' },
          },
          messages: [
            {
              role: MessageRole.User,
              content: 'DM message',
              createdAt: '2026-02-26T10:00:00Z',
              personaName: 'User',
              tokenCount: 5,
            },
          ],
        },
      ];

      // Budget is too small for the rawHistory entry but enough for cross-channel:
      // it must clear the <prior_conversations> wrapper overhead, which includes
      // the instruction text, while staying far below the 2000-token entry.
      const rawHistory = [{ role: 'user', content: 'A'.repeat(4000), tokenCount: 2000 }];

      const budget = 250;
      // Fails loudly if the <prior_conversations> instruction ever outgrows
      // this fixture, so the constant can't silently stop meaning "cross-channel fits".
      expect(budget).toBeGreaterThan(countTextTokens(getPriorConversationsWrapperOverheadText()));
      const result = manager.selectAndSerializeHistory(
        rawHistory as Parameters<typeof manager.selectAndSerializeHistory>[0],
        { name: 'TestAI' },
        budget,
        { headerIdTags: new Map(), crossChannelGroups }
      );

      // No current-channel messages fit, so no wrapper overhead should be counted
      // Cross-channel should still be included (gets the full budget)
      expect(result.messagesIncluded).toBe(0);
      expect(result.serializedHistory).toContain('DM message');
      expect(result.serializedHistory).not.toContain('<chat_log>');
    });

    it('should return empty when rawHistory is empty and no cross-channel groups', () => {
      const result = manager.selectAndSerializeHistory([], { name: 'TestAI' }, 5000, {
        headerIdTags: new Map(),
      });

      expect(result.serializedHistory).toBe('');
      expect(result.historyTokensUsed).toBe(0);
    });

    it('should not add <current_conversation> wrapper when no environment is provided', () => {
      const rawHistory = [
        { role: 'user', content: 'Hello', createdAt: '2026-02-26T10:00:00Z', tokenCount: 5 },
      ];

      const result = manager.selectAndSerializeHistory(rawHistory, { name: 'TestAI' }, 1000, {
        headerIdTags: new Map(),
      });

      expect(result.serializedHistory).toContain('Hello');
      expect(result.serializedHistory).not.toContain('<current_conversation>');
      expect(result.serializedHistory).not.toContain('<location');
    });

    it('should wrap current channel in <current_conversation> with location when environment is provided', () => {
      const rawHistory = [
        { role: 'user', content: 'Hello', createdAt: '2026-02-26T10:00:00Z', tokenCount: 5 },
        {
          role: 'assistant',
          content: 'Hi there!',
          createdAt: '2026-02-26T10:01:00Z',
          tokenCount: 5,
        },
      ];
      const environment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'g-1', name: 'Test Server' },
        channel: { id: 'ch-1', name: 'chat', type: 'text' },
      };

      const result = manager.selectAndSerializeHistory(rawHistory, { name: 'TestAI' }, 1000, {
        headerIdTags: new Map(),
        currentEnvironment: environment,
      });

      expect(result.serializedHistory).toContain('<current_conversation>');
      expect(result.serializedHistory).toContain('</current_conversation>');
      expect(result.serializedHistory).toContain('<location type="guild">');
      expect(result.serializedHistory).toContain('<server name="Test Server"/>');
      expect(result.serializedHistory).toContain('<channel name="chat" type="text"/>');
      expect(result.serializedHistory).toContain('Hello');
      expect(result.serializedHistory).toContain('Hi there!');
      expect(result.messagesIncluded).toBe(2);
    });

    it('should wrap current channel with DM location', () => {
      const rawHistory = [
        { role: 'user', content: 'DM hello', createdAt: '2026-02-26T10:00:00Z', tokenCount: 5 },
      ];
      const environment: DiscordEnvironment = {
        type: 'dm',
        channel: { id: 'dm-1', name: 'DM', type: 'dm' },
      };

      const result = manager.selectAndSerializeHistory(rawHistory, { name: 'TestAI' }, 1000, {
        headerIdTags: new Map(),
        currentEnvironment: environment,
      });

      expect(result.serializedHistory).toContain('<current_conversation>');
      expect(result.serializedHistory).toContain(
        '<location type="dm">Direct Message (private one-on-one chat)</location>'
      );
      expect(result.serializedHistory).toContain('DM hello');
    });

    it('should combine cross-channel and current_conversation wrapper correctly', () => {
      const rawHistory = [
        {
          role: 'user',
          content: 'Current msg',
          createdAt: '2026-02-27T10:00:00Z',
          tokenCount: 10,
        },
      ];
      const crossChannelGroups = [
        {
          channelEnvironment: {
            type: 'guild' as const,
            guild: { id: 'g-1', name: 'Server' },
            channel: { id: 'ch-other', name: 'general', type: 'text' },
          },
          messages: [
            {
              role: MessageRole.User,
              content: 'Cross msg',
              createdAt: '2026-02-26T10:00:00Z',
              personaName: 'User',
              tokenCount: 10,
            },
          ],
        },
      ];
      const environment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'g-1', name: 'Server' },
        channel: { id: 'ch-current', name: 'dev', type: 'text' },
      };

      const result = manager.selectAndSerializeHistory(rawHistory, { name: 'TestAI' }, 5000, {
        headerIdTags: new Map(),
        crossChannelGroups,
        currentEnvironment: environment,
      });

      // Cross-channel should come first (prior_conversations)
      expect(result.serializedHistory).toContain('<prior_conversations>');
      // Current channel should be wrapped in <current_conversation>
      expect(result.serializedHistory).toContain('<current_conversation>');
      expect(result.serializedHistory).toContain('<channel name="dev" type="text"/>');

      // Verify ordering: prior_conversations before current_conversation
      const priorIdx = result.serializedHistory.indexOf('<prior_conversations>');
      const currentIdx = result.serializedHistory.indexOf('<current_conversation>');
      expect(priorIdx).toBeLessThan(currentIdx);
    });

    it('should not reduce cross-channel budget when environment is provided but no current history exists', () => {
      const crossChannelGroups = [
        {
          channelEnvironment: {
            type: 'guild' as const,
            guild: { id: 'g-1', name: 'Server' },
            channel: { id: 'ch-other', name: 'general', type: 'text' },
          },
          messages: [
            {
              role: MessageRole.User,
              content: 'Cross msg in other channel',
              createdAt: '2026-02-26T10:00:00Z',
              personaName: 'User',
              tokenCount: 10,
            },
          ],
        },
      ];
      const environment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'g-1', name: 'Server' },
        channel: { id: 'ch-current', name: 'dev', type: 'text' },
      };

      // No current history — environment is provided but nothing to wrap
      const withEnv = manager.selectAndSerializeHistory([], { name: 'TestAI' }, 5000, {
        headerIdTags: new Map(),
        crossChannelGroups,
        currentEnvironment: environment,
      });
      const withoutEnv = manager.selectAndSerializeHistory([], { name: 'TestAI' }, 5000, {
        headerIdTags: new Map(),
        crossChannelGroups,
      });

      // Cross-channel should get the full budget in both cases (no wrapper overhead deducted)
      expect(withEnv.serializedHistory).toContain('Cross msg in other channel');
      expect(withEnv.serializedHistory).not.toContain('<current_conversation>');
      expect(withEnv.historyTokensUsed).toBe(withoutEnv.historyTokensUsed);
      expect(withEnv.crossChannelMessagesIncluded).toBe(1);
    });

    it('should not add <current_conversation> wrapper when no current messages fit budget', () => {
      const rawHistory = [
        {
          role: 'user',
          content: 'A'.repeat(4000),
          createdAt: '2026-02-26T10:00:00Z',
          tokenCount: 2000,
        },
      ];
      const environment: DiscordEnvironment = {
        type: 'dm',
        channel: { id: 'dm-1', name: 'DM', type: 'dm' },
      };

      const result = manager.selectAndSerializeHistory(rawHistory, { name: 'TestAI' }, 10, {
        headerIdTags: new Map(),
        currentEnvironment: environment,
      });

      // No messages fit, so no wrapper should be added
      expect(result.serializedHistory).toBe('');
      expect(result.messagesIncluded).toBe(0);
    });

    it('should account for <current_conversation> wrapper overhead in token budget', () => {
      const rawHistory = [
        { role: 'user', content: 'Hello', createdAt: '2026-02-26T10:00:00Z', tokenCount: 5 },
      ];
      const environment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'g-1', name: 'Test Server' },
        channel: { id: 'ch-1', name: 'chat', type: 'text' },
      };

      const withEnv = manager.selectAndSerializeHistory(rawHistory, { name: 'TestAI' }, 1000, {
        headerIdTags: new Map(),
        currentEnvironment: environment,
      });
      const withoutEnv = manager.selectAndSerializeHistory(rawHistory, { name: 'TestAI' }, 1000, {
        headerIdTags: new Map(),
      });

      // With environment should use more tokens due to wrapper overhead
      expect(withEnv.historyTokensUsed).toBeGreaterThan(withoutEnv.historyTokensUsed);
    });
  });

  describe('chunked history eviction (§2.5)', () => {
    // Real content, not a declared tokenCount — selection measures the
    // RENDERED entry, so a fixture sized only by a `tokenCount` field would
    // size nothing.
    const RESPONDER = { name: 'TestAI', id: 'personality-1' };
    const bulk = 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(6);

    function buildEntries(count: number): StructuredHistoryEntry[] {
      return Array.from({ length: count }, (_, n) => ({
        id: `id-${n}`,
        discordMessageId: [`snowflake-${n}`],
        role: n % 2 === 0 ? 'user' : 'assistant',
        content: `entry ${n} ${bulk}`,
        personaId: n % 2 === 0 ? 'persona-1' : undefined,
        personaName: n % 2 === 0 ? 'Vlad' : undefined,
        personalityId: n % 2 === 1 ? RESPONDER.id : undefined,
        personalityName: n % 2 === 1 ? RESPONDER.name : undefined,
        createdAt: new Date(1_000_000 + n * 60_000).toISOString(),
      }));
    }

    function measuresFor(entries: StructuredHistoryEntry[]): number[] {
      const allNames = new Set([RESPONDER.name]);
      return entries.map(e =>
        measureHistoryEntryTokens(e, RESPONDER.name, allNames, RESPONDER.id, false)
      );
    }

    it('OSCILLATION — when the cut is active and unclamped, shipped tokens land in (0.75*budget, budget]', () => {
      const entries = buildEntries(60);
      const measures = measuresFor(entries);
      const sTotal = measures.reduce((a, b) => a + b, 0);
      const budget = Math.round(sTotal * 0.5);

      const cut = computeEvictionCut(measures, budget);

      // Precondition: the cut is genuinely the quantized (unclamped) one —
      // neither the minimal-fit clamp nor the floor clamp is binding.
      expect(cut.k).toBeGreaterThan(0);
      expect(cut.cFinal).not.toBe(cut.cMin);
      expect(cut.cFinal).not.toBe(entries.length - 20);

      const shippedTokens = measures.slice(cut.cFinal).reduce((a, b) => a + b, 0);
      expect(shippedTokens).toBeGreaterThan(0.75 * budget);
      expect(shippedTokens).toBeLessThanOrEqual(budget);
    });

    it('HYSTERESIS / HEAD STABILITY — the shipped head is stable across tail appends, then jumps by a whole chunk', () => {
      // `measureHistoryEntryTokens` renders one entry with no history-entry set
      // (`historyTokenMeasure.ts`), and `buildEntries` fills each field from its
      // own index, so a single pass over the longest fixture supplies every
      // prefix the loop needs rather than re-tokenizing one per iteration.
      const MAX_EXTRA = 25;
      const allEntries = buildEntries(60 + MAX_EXTRA);
      const allMeasures = measuresFor(allEntries);
      const budget = Math.round(allMeasures.slice(0, 60).reduce((a, b) => a + b, 0) * 0.5);

      const cuts: { cFinal: number; oldestShippedId: string | undefined }[] = [];
      for (let extra = 0; extra <= MAX_EXTRA; extra++) {
        const entries = allEntries.slice(0, 60 + extra);
        const measures = allMeasures.slice(0, 60 + extra);
        const cut = computeEvictionCut(measures, budget);
        cuts.push({
          cFinal: cut.cFinal,
          oldestShippedId: entries[cut.cFinal]?.id,
        });
      }

      // At least one plateau: the oldest-shipped IDENTITY does NOT change
      // across at least two consecutive appends. Asserted on the entry id
      // rather than the cut index because identity is what a prefix cache
      // keys on — a head that keeps its id keeps the cached prefix warm.
      const hasPlateau = cuts.some(
        (c, i) => i > 0 && c.oldestShippedId === cuts[i - 1].oldestShippedId
      );
      expect(hasPlateau).toBe(true);
      // Whenever the cut index does move, the head identity moves with it —
      // the two cannot disagree, so a plateau in one is a plateau in both.
      for (let i = 1; i < cuts.length; i++) {
        expect(cuts[i].oldestShippedId === cuts[i - 1].oldestShippedId).toBe(
          cuts[i].cFinal === cuts[i - 1].cFinal
        );
      }

      // Every transition, when it happens, moves the head by MORE than one
      // entry (a whole-chunk jump), never a one-at-a-time slide.
      const transitions = cuts
        .map((c, i) => (i > 0 ? c.cFinal - cuts[i - 1].cFinal : 0))
        .filter(delta => delta !== 0);
      expect(transitions.length).toBeGreaterThan(0);
      for (const delta of transitions) {
        expect(Math.abs(delta)).toBeGreaterThan(1);
      }
    });

    it('FLOOR — quantization never leaves fewer than the floor when at least the floor fits minimally', () => {
      const entries = buildEntries(60);
      const measures = measuresFor(entries);
      const sTotal = measures.reduce((a, b) => a + b, 0);
      // Sized so the RAW quantized cut (cQ) would overshoot past the floor —
      // this is the fraction where the `Math.min(cQ, n - FLOOR)` clamp is
      // actually load-bearing, not merely a no-op upper bound.
      const budget = Math.round(sTotal * 0.35);

      const cut = computeEvictionCut(measures, budget);
      const fitCount = entries.length - cut.cMin;
      const shipped = entries.length - cut.cFinal;

      expect(fitCount).toBeGreaterThanOrEqual(20);
      expect(shipped).toBeGreaterThanOrEqual(20);
    });

    it('FLOOR — the MINIMAL cut MAY leave fewer than the floor when the budget is small (budget wins over the floor)', () => {
      const entries = buildEntries(60);
      const measures = measuresFor(entries);
      const sTotal = measures.reduce((a, b) => a + b, 0);
      const budget = Math.round(sTotal * 0.3);

      const cut = computeEvictionCut(measures, budget);
      const shipped = entries.length - cut.cFinal;

      expect(cut.k).toBe(0);
      expect(cut.cFinal).toBe(cut.cMin);
      expect(shipped).toBeLessThan(20);
    });

    it('FLAG-ON CROSS-CHANNEL — the cross-channel HumanMessage is charged one wire overhead on top of its XML cost', () => {
      // No current-channel history, so historyTokensUsed IS the cross-channel
      // charge — the serialized XML is flag-independent, making the flag
      // delta exactly the one per-message wire overhead the flag-on path
      // pays for shipping the XML as its own HumanMessage.
      const crossChannelGroups = [
        {
          channelEnvironment: {
            type: 'guild' as const,
            guild: { id: 'g-x', name: 'Server' },
            channel: { id: 'ch-x', name: 'other', type: 'text' },
          },
          messages: [
            {
              role: MessageRole.User,
              content: 'Cross-channel wire-overhead fixture message',
              createdAt: '2026-02-26T10:00:00Z',
              tokenCount: 5,
            },
          ],
        },
      ];

      const off = manager.selectAndSerializeHistory([], RESPONDER, 5_000, {
        headerIdTags: new Map(),
        crossChannelGroups,
      });
      const on = manager.selectAndSerializeHistory([], RESPONDER, 5_000, {
        headerIdTags: new Map(),
        crossChannelGroups,
        realMessagesEnabled: true,
      });

      expect(off.crossChannelMessagesIncluded).toBe(1);
      expect(on.crossChannelXml).toBe(off.crossChannelXml);
      expect(on.historyTokensUsed).toBe(off.historyTokensUsed + PER_MESSAGE_WIRE_OVERHEAD_TOKENS);
    });

    it('OVERSIZED-BOUNDARY — a single entry comparable to the chunk quantum deepens the cut below the nominal band, degraded-but-safe', () => {
      // Skewed fixture: 30 small entries, one 200-token entry, 30 more small.
      // Budget 520 puts the quantize threshold INSIDE the big entry's span, so
      // the entry-boundary cut evicts the whole entry and shipped tokens land
      // BELOW the nominal 75% band — the qualified bound in the doc-comment
      // (shipped > budget - q - boundaryEntry) is what actually holds.
      const measures = [
        ...Array.from({ length: 30 }, () => 10),
        200,
        ...Array.from({ length: 30 }, () => 10),
      ];
      const budget = 520;

      const cut = computeEvictionCut(measures, budget);
      const shipped = measures.slice(cut.cFinal).reduce((a, b) => a + b, 0);
      const boundaryEntry = measures[cut.cFinal - 1];

      // Active and floor-unclamped: the cut is genuinely the quantized one.
      expect(cut.cFinal).toBeGreaterThan(cut.cMin);
      expect(cut.cFinal).toBeLessThan(measures.length - 20);
      // The big entry is the one straddling the threshold.
      expect(boundaryEntry).toBe(200);
      // Safety holds unconditionally...
      expect(shipped).toBeLessThanOrEqual(budget);
      // ...the NOMINAL band does not (this is the reviewer-caught case)...
      expect(shipped).toBeLessThan(0.75 * budget);
      // ...and the QUALIFIED bound is the true floor.
      expect(shipped).toBeGreaterThan(budget - cut.q - boundaryEntry);
    });

    it('NON-POSITIVE BUDGET — the exported function evicts everything instead of dividing by zero', () => {
      // Zero-cost entries "fit" any budget, so 20+ of them reach the quantize
      // branch where q would be 0 — the guard returns before that.
      const measures = [10, ...Array.from({ length: 25 }, () => 0)];

      const cut = computeEvictionCut(measures, 0);

      expect(cut).toEqual({ cFinal: 26, cMin: 26, k: 0, q: 0, sTotal: 10 });
    });

    it('EXACT-FLOOR BOUNDARY — at fitCount === floor the quantize branch runs (k > 0) but the floor clamp collapses the cut to the minimal one', () => {
      // Synthetic uniform measures drive the pure function directly: 40
      // entries of 10 tokens each, budget 205 -> exactly 20 fit minimally
      // (200 <= 205 < 210), which is the entry floor. The quantize branch is
      // entered (fitCount is NOT below the floor), computes a nonzero k, and
      // the `Math.min(cQ, n - floor)` clamp then lands the cut back on cMin —
      // a shipped set identical to the pre-hysteresis minimal walk. Pinned so
      // the k-vs-cFinal relationship at this boundary is a stated fact rather
      // than a surprise, and because the eviction log gates on
      // `cFinal > cMin` for exactly this case.
      const measures = Array.from({ length: 40 }, () => 10);
      const cut = computeEvictionCut(measures, 205);

      expect(cut.cMin).toBe(20);
      expect(cut.k).toBeGreaterThan(0);
      expect(cut.cFinal).toBe(cut.cMin);
    });

    it('FLAG-ON ALL-SKIPPED — rows the real-message render skips are excluded at SELECTION, not merely priced at zero', () => {
      // Empty-content assistant rows: the flag-on measure prices each at 0,
      // which is the render's own skip signal — so selection excludes them,
      // keeping selectedEntries equal to the set the model actually receives.
      // They are neither included nor "dropped" (no budget touched them).
      const entries: StructuredHistoryEntry[] = Array.from({ length: 3 }, (_, n) => ({
        id: `id-${n}`,
        discordMessageId: [`snowflake-${n}`],
        role: 'assistant',
        content: '',
        personalityId: RESPONDER.id,
        personalityName: RESPONDER.name,
        createdAt: new Date(1_000_000 + n * 60_000).toISOString(),
      }));

      const result = manager.selectAndSerializeHistory(entries, RESPONDER, 5_000, {
        headerIdTags: new Map(),
        realMessagesEnabled: true,
      });

      expect(result.messagesIncluded).toBe(0);
      expect(result.selectedEntries).toEqual([]);
      expect(result.messagesDropped).toBe(0);
      expect(result.historyTokensUsed).toBe(0);
    });

    it('QUOTE OF A RENDER-SKIPPED ROW — renders in full, not as a dedup stub, because the row is absent from the shipped window', () => {
      // The quote-dedup index is built from selectedEntries downstream
      // (buildHistoryEntryIndex over the shipped window). A row the render
      // skips is not visible to the model, so a quote of it must carry the
      // full reference snapshot — a stub pointing at content the model never
      // received would dangle.
      const entries: StructuredHistoryEntry[] = [
        {
          id: 'id-skip',
          discordMessageId: ['skip-quoted'],
          role: 'assistant',
          content: '',
          personalityId: RESPONDER.id,
          personalityName: RESPONDER.name,
          createdAt: new Date(1_000_000).toISOString(),
        },
        {
          id: 'id-quoter',
          discordMessageId: ['snowflake-quoter'],
          role: 'user',
          content: 'replying to the empty one',
          personaId: 'p-1',
          personaName: 'Vlad',
          createdAt: new Date(1_060_000).toISOString(),
          messageMetadata: {
            referencedMessages: [
              {
                discordMessageId: 'skip-quoted',
                authorUsername: 'x',
                authorDisplayName: 'X',
                content: 'the words the skipped row once carried',
                timestamp: new Date(1_000_000).toISOString(),
                locationContext: '',
              },
            ],
          },
        },
      ];

      const result = manager.selectAndSerializeHistory(entries, RESPONDER, 5_000, {
        headerIdTags: new Map(),
        realMessagesEnabled: true,
      });
      expect(result.selectedEntries.map(e => e.id)).toEqual(['id-quoter']);

      const messages = buildRealMessages(result.selectedEntries, {
        personalityName: RESPONDER.name,
        responderPersonalityId: RESPONDER.id,
        realMessagesEnabled: true,
        headerSpoofNeutralizeEnabled: false,
        headerIdTags: new Map(),
      });
      expect(messages).toHaveLength(1);
      expect(String(messages[0].content)).toContain('the words the skipped row once carried');
    });

    it('QUOTE OF A RENDER-SKIPPED ROW, FLAG-OFF — the XML path renders the quote in full too (shared dedup index, same mechanism)', () => {
      // Flag-off sibling of the test above: a null-speaker row is the XML
      // path's render-skipped shape, and the quote-dedup index is the same
      // buildHistoryEntryIndex(selectedEntries) both paths share.
      const entries: StructuredHistoryEntry[] = [
        {
          id: 'id-sys',
          discordMessageId: ['skip-quoted-xml'],
          role: 'system',
          content: 'renderer has no speaker for this',
          createdAt: new Date(1_000_000).toISOString(),
        },
        {
          id: 'id-quoter',
          discordMessageId: ['snowflake-quoter'],
          role: 'user',
          content: 'replying to the skipped one',
          personaId: 'p-1',
          personaName: 'Vlad',
          createdAt: new Date(1_060_000).toISOString(),
          messageMetadata: {
            referencedMessages: [
              {
                discordMessageId: 'skip-quoted-xml',
                authorUsername: 'x',
                authorDisplayName: 'X',
                content: 'the words the skipped row once carried',
                timestamp: new Date(1_000_000).toISOString(),
                locationContext: '',
              },
            ],
          },
        },
      ];

      const result = manager.selectAndSerializeHistory(entries, RESPONDER, 5_000, {
        headerIdTags: new Map(),
      });

      expect(result.selectedEntries.map(e => e.id)).toEqual(['id-quoter']);
      expect(result.serializedHistory).toContain('the words the skipped row once carried');
    });

    it('FLOOR COUNTS ELIGIBLE ROWS — the 20-entry guarantee applies to renderable entries, never satisfied by render-skipped ones', () => {
      // 30 real rows + 10 render-skipped (empty assistant) rows, flag-on,
      // with a budget sized so the quantization overshoot clamps at the
      // floor: all 20 surviving entries must be renderable — a floor "met"
      // by rows the model never sees would protect nothing.
      const realRows: StructuredHistoryEntry[] = Array.from({ length: 60 }, (_, n) => ({
        id: `real-${n}`,
        discordMessageId: [`snowflake-real-${n}`],
        role: n % 2 === 0 ? 'user' : 'assistant',
        content: `entry ${n} ${bulk}`,
        personaId: n % 2 === 0 ? 'persona-1' : undefined,
        personaName: n % 2 === 0 ? 'Vlad' : undefined,
        personalityId: n % 2 === 1 ? RESPONDER.id : undefined,
        personalityName: n % 2 === 1 ? RESPONDER.name : undefined,
        createdAt: new Date(1_000_000 + n * 120_000).toISOString(),
      }));
      // Skip rows sit in the NEWEST region (interleaved with the last 10 real
      // rows), where any cut keeps them — placed in the head they would be
      // evicted with it and the all-real assertion below could never fail.
      const skipRows: StructuredHistoryEntry[] = Array.from({ length: 10 }, (_, n) => ({
        id: `skip-${n}`,
        discordMessageId: [`snowflake-skip-${n}`],
        role: 'assistant',
        content: '',
        personalityId: RESPONDER.id,
        personalityName: RESPONDER.name,
        createdAt: new Date(1_000_000 + (50 + n) * 120_000 + 60_000).toISOString(),
      }));
      const entries = realRows
        .flatMap((r, n) => (n >= 50 ? [r, skipRows[n - 50]] : [r]))
        .sort((a, b) => ((a.createdAt as string) < (b.createdAt as string) ? -1 : 1));

      const names = new Set([RESPONDER.name]);
      const realTotal = realRows.reduce(
        (sum, e) =>
          sum +
          measureHistoryEntryRealTokens(e, {
            personalityName: RESPONDER.name,
            allPersonalityNames: names,
            responderPersonalityId: RESPONDER.id,
            realMessagesEnabled: true,
            headerSpoofNeutralizeEnabled: false,
            headerIdTags: new Map(),
          }),
        0
      );
      const budget = Math.round(realTotal * 0.35);

      const result = manager.selectAndSerializeHistory(entries, RESPONDER, budget, {
        headerIdTags: new Map(),
        realMessagesEnabled: true,
      });

      expect(result.selectedEntries.length).toBeGreaterThanOrEqual(20);
      for (const e of result.selectedEntries) {
        expect(e.id).toMatch(/^real-/);
      }
    });

    it('BUDGET-EXHAUSTED + RENDER-SKIP — the drop count excludes render-skipped rows even when the whole budget is gone', () => {
      const entries: StructuredHistoryEntry[] = [
        {
          id: 'id-real',
          discordMessageId: ['snowflake-real'],
          role: 'user',
          content: 'a message the budget genuinely dropped',
          personaId: 'p-1',
          personaName: 'Vlad',
          createdAt: new Date(1_000_000).toISOString(),
        },
        {
          id: 'id-empty',
          discordMessageId: ['snowflake-empty'],
          role: 'assistant',
          content: '',
          personalityId: RESPONDER.id,
          personalityName: RESPONDER.name,
          createdAt: new Date(1_060_000).toISOString(),
        },
      ];

      const result = manager.selectAndSerializeHistory(entries, RESPONDER, 0, {
        headerIdTags: new Map(),
        realMessagesEnabled: true,
      });

      // Only the renderable row counts as budget-dropped; the render-skipped
      // row was never the budget's to drop, in this branch like every other.
      expect(result.selectedEntries).toEqual([]);
      expect(result.messagesDropped).toBe(1);
    });

    it('FLAG-ON MIXED — an empty-body assistant row among normal rows leaves selectedEntries, flag-off keeps it (it ships as an empty element there)', () => {
      const entries: StructuredHistoryEntry[] = [
        {
          id: 'id-user',
          discordMessageId: ['snowflake-user'],
          role: 'user',
          content: 'hello there',
          personaId: 'p-1',
          personaName: 'Vlad',
          createdAt: new Date(1_000_000).toISOString(),
        },
        {
          id: 'id-empty',
          discordMessageId: ['snowflake-empty'],
          role: 'assistant',
          content: '',
          personalityId: RESPONDER.id,
          personalityName: RESPONDER.name,
          createdAt: new Date(1_060_000).toISOString(),
        },
        {
          id: 'id-reply',
          discordMessageId: ['snowflake-reply'],
          role: 'assistant',
          content: 'a real reply',
          personalityId: RESPONDER.id,
          personalityName: RESPONDER.name,
          createdAt: new Date(1_120_000).toISOString(),
        },
      ];

      const on = manager.selectAndSerializeHistory(entries, RESPONDER, 5_000, {
        headerIdTags: new Map(),
        realMessagesEnabled: true,
      });
      const off = manager.selectAndSerializeHistory(entries, RESPONDER, 5_000, {
        headerIdTags: new Map(),
      });

      // Flag-on: the render will skip the empty row, so selection excludes it
      // — the dedup boundary derives from what actually ships.
      expect(on.selectedEntries.map(e => e.id)).toEqual(['id-user', 'id-reply']);
      expect(on.messagesDropped).toBe(0);
      // Flag-off: the XML path ships the row as an empty element, so it IS
      // shipped content and stays selected.
      expect(off.selectedEntries.map(e => e.id)).toEqual(['id-user', 'id-empty', 'id-reply']);
      expect(off.messagesDropped).toBe(0);
    });

    it('FLAG-OFF NULL-SPEAKER — a row the XML renderer declines is excluded from selectedEntries with byte-identical serialized output', () => {
      const speakable: StructuredHistoryEntry[] = [
        {
          id: 'id-a',
          discordMessageId: ['snowflake-a'],
          role: 'user',
          content: 'first message',
          personaId: 'p-1',
          personaName: 'Vlad',
          createdAt: new Date(1_000_000).toISOString(),
        },
        {
          id: 'id-b',
          discordMessageId: ['snowflake-b'],
          role: 'user',
          content: 'second message',
          personaId: 'p-1',
          personaName: 'Vlad',
          createdAt: new Date(1_060_000).toISOString(),
        },
      ];
      const nullSpeakerRow: StructuredHistoryEntry = {
        id: 'id-sys',
        discordMessageId: ['snowflake-sys'],
        role: 'system',
        content: 'renderer has no speaker for this',
        createdAt: new Date(1_030_000).toISOString(),
      };
      const withRow = [speakable[0], nullSpeakerRow, speakable[1]];

      const including = manager.selectAndSerializeHistory(withRow, RESPONDER, 5_000, {
        headerIdTags: new Map(),
      });
      const excluding = manager.selectAndSerializeHistory(speakable, RESPONDER, 5_000, {
        headerIdTags: new Map(),
      });

      // The row never rendered anything, so excluding it at selection leaves
      // the shipped bytes untouched — while selectedEntries (and the dedup
      // set derived from it) stops claiming a row the model never saw.
      expect(including.serializedHistory).toBe(excluding.serializedHistory);
      expect(including.selectedEntries.map(e => e.id)).toEqual(['id-a', 'id-b']);
      expect(including.messagesDropped).toBe(0);
    });

    it('DORMANCY PARITY — when the fetched history fits the budget, every entry ships in order, byte-identical to the pre-cut behavior', () => {
      const entries = buildEntries(5);

      // The cut itself reports the dormant shape: nothing evicted, and k
      // pinned at exactly 0. Asserted on a history ABOVE the entry floor,
      // which is what makes the `sTotal <= budget` fast-path observable: below
      // the floor the hysteresis-off branch returns the same k=0/q=0 shape, so
      // a small fixture cannot distinguish the two. Above it, skipping the
      // fast-path would fall through to the quantize branch and report a
      // negative k for a history that fits.
      const dormantMeasures = measuresFor(buildEntries(25));
      const dormantCut = computeEvictionCut(dormantMeasures, 100_000);
      expect(dormantCut).toEqual({ cFinal: 0, cMin: 0, k: 0, q: 0, sTotal: dormantCut.sTotal });

      const result = manager.selectAndSerializeHistory(entries, RESPONDER, 100_000, {
        headerIdTags: new Map(),
      });

      expect(result.messagesIncluded).toBe(5);
      expect(result.messagesDropped).toBe(0);
      expect(result.selectedEntries).toEqual(entries);
      for (let n = 0; n < entries.length; n++) {
        expect(result.serializedHistory).toContain(`entry ${n} `);
      }
    });
  });
});
