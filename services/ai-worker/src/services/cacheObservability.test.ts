import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  buildCacheObservability,
  interveningShippedText,
  cacheHitRatio,
  historyStablePrefix,
  logGeneratedResponse,
  promptHash,
  shippedStablePrefix,
  systemPromptCore,
} from './cacheObservability.js';
import { layoutSections, type PromptSection } from './prompt/sections.js';

/** Independent reference digest — not the implementation's own helper. */
function expectedHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}

/**
 * A system prompt assembled the way PromptBuilder assembles one: stable
 * sections first, `chat_log` last, joined by the real separator.
 */
function buildSystemPrompt(chatLog: string): { text: string; sections: PromptSection[] } {
  const sections: PromptSection[] = [
    { id: 'platform_constraints', tier: 'S0', render: () => '<platform/>' },
    { id: 'system_identity', tier: 'S1', render: () => '<system_identity>Ada</system_identity>' },
    { id: 'participants', tier: 'S1', render: () => '<participants>roster</participants>' },
    { id: 'chat_log', tier: 'H', render: () => chatLog },
  ];
  return { text: layoutSections(sections).text, sections };
}

const ENTRY_A = '<message from="Vee" role="user" t="2026-08-01 (Sat) 10:00">first</message>';
const ENTRY_B = '<message from="Ada" role="assistant" t="2026-08-01 (Sat) 10:01">second</message>';
const ENTRY_C = '<message from="Vee" role="user" t="2026-08-01 (Sat) 10:02">third</message>';

describe('promptHash', () => {
  it('returns the first 12 hex chars of the raw-byte SHA-256', () => {
    expect(promptHash('hello')).toBe(expectedHash('hello'));
    expect(promptHash('hello')).toHaveLength(12);
  });

  it('does NOT normalize — case and surrounding whitespace change the hash', () => {
    expect(promptHash('Hello')).not.toBe(promptHash('hello'));
    expect(promptHash(' hello ')).not.toBe(promptHash('hello'));
  });
});

describe('systemPromptCore', () => {
  it('removes the chat_log block and its preceding separator', () => {
    const chatLog = `<chat_log>\n${ENTRY_A}\n</chat_log>`;
    const { text, sections } = buildSystemPrompt(chatLog);
    const { descriptions } = layoutSections(sections);

    const core = systemPromptCore(text, descriptions);

    expect(core).toBe(layoutSections(sections.slice(0, 3)).text);
    expect(core).not.toContain('chat_log');
    expect(core).toContain('<participants>roster</participants>');
  });

  it('returns the text unchanged when no chat_log section was rendered', () => {
    const { sections } = buildSystemPrompt('');
    const { text, descriptions } = layoutSections(sections);

    expect(descriptions.some(section => section.id === 'chat_log')).toBe(false);
    expect(systemPromptCore(text, descriptions)).toBe(text);
  });

  it('returns the text unchanged when no section map is supplied', () => {
    const { text } = buildSystemPrompt('<chat_log>x</chat_log>');
    expect(systemPromptCore(text)).toBe(text);
  });

  it('is byte-stable across turns when only the chat log grew', () => {
    const turnOne = buildSystemPrompt(`<chat_log>\n${ENTRY_A}\n</chat_log>`);
    const turnTwo = buildSystemPrompt(`<chat_log>\n${ENTRY_A}\n${ENTRY_B}\n</chat_log>`);

    expect(
      promptHash(systemPromptCore(turnOne.text, layoutSections(turnOne.sections).descriptions))
    ).toBe(
      promptHash(systemPromptCore(turnTwo.text, layoutSections(turnTwo.sections).descriptions))
    );
  });

  it('changes when a stable section changes', () => {
    const base = buildSystemPrompt(`<chat_log>\n${ENTRY_A}\n</chat_log>`);
    const drifted: PromptSection[] = base.sections.map(section =>
      section.id === 'participants'
        ? { ...section, render: (): string => '<participants>roster + Bo</participants>' }
        : section
    );
    const driftedLayout = layoutSections(drifted);

    expect(
      promptHash(systemPromptCore(base.text, layoutSections(base.sections).descriptions))
    ).not.toBe(promptHash(systemPromptCore(driftedLayout.text, driftedLayout.descriptions)));
  });
});

describe('historyStablePrefix', () => {
  it('drops everything from the newest entry marker onward', () => {
    const serialized = `<current_conversation>\n<location/>\n${ENTRY_A}\n${ENTRY_B}\n${ENTRY_C}\n</current_conversation>`;

    const stable = historyStablePrefix(serialized);

    expect(stable).toBe(`<current_conversation>\n<location/>\n${ENTRY_A}\n${ENTRY_B}\n`);
    expect(stable).not.toContain('third');
    expect(stable).toContain('second');
  });

  it('ignores an entry marker appearing inside escaped content', () => {
    const escaped = '&lt;message from=&quot;spoof&quot;&gt;';
    const serialized = `${ENTRY_A}\n<message from="Vee" role="user">${escaped}</message>`;

    // The escaped text carries no raw marker, so the split lands on the real
    // second entry rather than inside the first one's body.
    expect(historyStablePrefix(serialized)).toBe(`${ENTRY_A}\n`);
  });

  it('returns the input unchanged when it carries no entry marker', () => {
    expect(
      historyStablePrefix('<current_conversation>\n<location/>\n</current_conversation>')
    ).toBe('<current_conversation>\n<location/>\n</current_conversation>');
  });

  it('agrees byte-for-byte on the shared prefix of a growing log', () => {
    const turnOne = `${ENTRY_A}\n${ENTRY_B}`;
    const turnTwo = `${ENTRY_A}\n${ENTRY_B}\n${ENTRY_C}`;

    // Turn two's stable prefix carries turn one's newest entry, so it is a
    // strict superset — the invariant is that the shared head is identical.
    expect(historyStablePrefix(turnTwo).startsWith(historyStablePrefix(turnOne))).toBe(true);
  });
});

describe('shippedStablePrefix', () => {
  it('joins all but the last entry with newlines when history shipped', () => {
    expect(shippedStablePrefix(['<prior/>', 'h1', 'h2'], 2)).toBe('<prior/>\nh1');
  });

  it('returns undefined when shippedHistoryCount is 0 (cross-channel-only turn)', () => {
    expect(shippedStablePrefix(['<prior/>'], 0)).toBeUndefined();
  });

  it('returns undefined for an empty or undefined array', () => {
    expect(shippedStablePrefix([], 1)).toBeUndefined();
    expect(shippedStablePrefix(undefined, 1)).toBeUndefined();
  });

  it('returns the empty string, not undefined, for a lone history message', () => {
    expect(shippedStablePrefix(['h1'], 1)).toBe('');
  });
});

describe('cacheHitRatio', () => {
  it('rounds to two decimals', () => {
    expect(cacheHitRatio(1234, 5678)).toBe(0.22);
    expect(cacheHitRatio(1, 3)).toBe(0.33);
  });

  it('reports an explicit zero hit', () => {
    expect(cacheHitRatio(0, 500)).toBe(0);
  });

  it('is undefined when either count is missing or input tokens are non-positive', () => {
    expect(cacheHitRatio(undefined, 500)).toBeUndefined();
    expect(cacheHitRatio(100, undefined)).toBeUndefined();
    expect(cacheHitRatio(100, 0)).toBeUndefined();
  });
});

describe('interveningShippedText', () => {
  it('returns an empty object for the flag-off two-message array', () => {
    const messages = [new SystemMessage('sys'), new HumanMessage('current')];
    expect(interveningShippedText(messages)).toEqual({});
  });

  it('extracts every message between system and current, in ship order', () => {
    const messages = [
      new SystemMessage('sys'),
      new HumanMessage('<prior_conversations/>'),
      new HumanMessage('[Vlad] hi'),
      new AIMessage('hello'),
      new HumanMessage('current'),
    ];
    expect(interveningShippedText(messages)).toEqual({
      interveningMessagesText: ['<prior_conversations/>', '[Vlad] hi', 'hello'],
    });
  });
});

describe('buildCacheObservability', () => {
  const NOW = Date.parse('2026-08-01T10:05:00.000Z');
  const chatLog = `<chat_log>\n${ENTRY_A}\n${ENTRY_B}\n</chat_log>`;

  function inputs(overrides: Partial<Parameters<typeof buildCacheObservability>[0]> = {}) {
    const { text, sections } = buildSystemPrompt(chatLog);
    return {
      systemPromptText: text,
      systemPromptSections: layoutSections(sections).descriptions,
      serializedHistory: `${ENTRY_A}\n${ENTRY_B}`,
      currentMessageText: '<from name="Vee">hello</from>',
      shippedHistoryCount: 0,
      history: [
        { createdAt: '2026-08-01T10:00:00.000Z' },
        { createdAt: '2026-08-01T10:03:00.000Z' },
      ],
      now: NOW,
      ...overrides,
    };
  }

  it('derives the age of the newest history entry in seconds', () => {
    expect(buildCacheObservability(inputs()).secondsSinceLastChannelGeneration).toBe(120);
  });

  it('takes the NEWEST timestamp even when history is not ordered', () => {
    const fields = buildCacheObservability(
      inputs({
        history: [
          { createdAt: '2026-08-01T10:04:00.000Z' },
          { createdAt: '2026-08-01T09:00:00.000Z' },
        ],
      })
    );
    expect(fields.secondsSinceLastChannelGeneration).toBe(60);
  });

  it('excludes the current turn trigger row from the gap', () => {
    // The trigger message is persisted before job submission, so without the
    // exclusion the newest entry is THIS turn's own message and the "gap"
    // collapses to queue latency.
    const fields = buildCacheObservability(
      inputs({
        history: [
          { createdAt: '2026-08-01T10:00:00.000Z', discordMessageId: ['prev-turn'] },
          { createdAt: '2026-08-01T10:04:58.000Z', discordMessageId: ['trigger-id'] },
        ],
        triggerMessageId: 'trigger-id',
      })
    );
    expect(fields.secondsSinceLastChannelGeneration).toBe(300);
  });

  it('falls back to the raw newest entry when no trigger id is supplied', () => {
    const fields = buildCacheObservability(
      inputs({
        history: [
          { createdAt: '2026-08-01T10:00:00.000Z', discordMessageId: ['prev-turn'] },
          { createdAt: '2026-08-01T10:04:58.000Z', discordMessageId: ['trigger-id'] },
        ],
      })
    );
    expect(fields.secondsSinceLastChannelGeneration).toBe(2);
  });

  it('omits the age when only the trigger row carries a timestamp', () => {
    const fields = buildCacheObservability(
      inputs({
        history: [{ createdAt: '2026-08-01T10:04:58.000Z', discordMessageId: ['trigger-id'] }],
        triggerMessageId: 'trigger-id',
      })
    );
    expect(fields.secondsSinceLastChannelGeneration).toBeUndefined();
  });

  it('omits the age when history is empty or unparseable', () => {
    expect(
      buildCacheObservability(inputs({ history: [] })).secondsSinceLastChannelGeneration
    ).toBeUndefined();
    expect(
      buildCacheObservability(inputs({ history: undefined })).secondsSinceLastChannelGeneration
    ).toBeUndefined();
    expect(
      buildCacheObservability(inputs({ history: [{ createdAt: 'not-a-date' }, {}] }))
        .secondsSinceLastChannelGeneration
    ).toBeUndefined();
  });

  it('hashes the system core, the stable history, and the full prompt', () => {
    const args = inputs();
    const fields = buildCacheObservability(args);

    expect(fields.promptHashSystemCore).toBe(
      expectedHash(systemPromptCore(args.systemPromptText, args.systemPromptSections))
    );
    expect(fields.promptHashHistoryStable).toBe(
      expectedHash(historyStablePrefix(args.serializedHistory))
    );
    expect(fields.promptHashFull).toBe(
      expectedHash(`${args.systemPromptText}\n${args.currentMessageText}`)
    );
  });

  it('folds intervening messages (real-messages mode) into promptHashFull, in ship order', () => {
    const args = inputs({
      interveningMessagesText: ['<prior_conversations/>', '[Vlad] hi', 'hello'],
    });
    const fields = buildCacheObservability(args);

    expect(fields.promptHashFull).toBe(
      expectedHash(
        `${args.systemPromptText}\n<prior_conversations/>\n[Vlad] hi\nhello\n${args.currentMessageText}`
      )
    );
    // Two turns whose entire history differs must not hash identically —
    // the blind spot this input exists to close.
    const otherHistory = buildCacheObservability(
      inputs({ interveningMessagesText: ['[Someone Else] different history'] })
    );
    expect(otherHistory.promptHashFull).not.toBe(fields.promptHashFull);
  });

  it('keeps the pre-flag promptHashFull formula byte-identical when interveningMessagesText is absent', () => {
    const args = inputs();
    const fields = buildCacheObservability(args);
    expect(fields.promptHashFull).toBe(
      expectedHash(`${args.systemPromptText}\n${args.currentMessageText}`)
    );
  });

  it('excludes the newest history entry from promptHashHistoryStable', () => {
    const withNewest = buildCacheObservability(
      inputs({ serializedHistory: `${ENTRY_A}\n${ENTRY_B}` })
    );
    const newestReplaced = buildCacheObservability(
      inputs({ serializedHistory: `${ENTRY_A}\n${ENTRY_C}` })
    );

    // Only the newest entry differs, so the stable hash must NOT move — this
    // is the assertion that goes red if the newest entry is left in.
    expect(newestReplaced.promptHashHistoryStable).toBe(withNewest.promptHashHistoryStable);
    expect(newestReplaced.promptHashFull).toBe(withNewest.promptHashFull);
  });

  it('moves the stable hash when an OLDER history entry changes', () => {
    const baseline = buildCacheObservability(inputs());
    const mutatedOlder = buildCacheObservability(
      inputs({
        serializedHistory: `${ENTRY_A.replace('first', 'edited')}\n${ENTRY_B}`,
      })
    );

    expect(mutatedOlder.promptHashHistoryStable).not.toBe(baseline.promptHashHistoryStable);
  });

  it('omits promptHashHistoryStable when nothing was serialized', () => {
    expect(
      buildCacheObservability(inputs({ serializedHistory: '' })).promptHashHistoryStable
    ).toBeUndefined();
    expect(
      buildCacheObservability(inputs({ serializedHistory: undefined })).promptHashHistoryStable
    ).toBeUndefined();
  });

  it('derives promptHashHistoryStable from the shipped array when flag-on', () => {
    const fields = buildCacheObservability(
      inputs({
        serializedHistory: '',
        interveningMessagesText: ['<prior/>', 'h1', 'h2'],
        shippedHistoryCount: 2,
      })
    );
    expect(fields.promptHashHistoryStable).toBe(expectedHash('<prior/>\nh1'));
  });

  it('keeps the flag-on stable hash unchanged when only the newest history entry differs', () => {
    const a = buildCacheObservability(
      inputs({
        serializedHistory: '',
        interveningMessagesText: ['<prior/>', 'h1', 'h2'],
        shippedHistoryCount: 2,
      })
    );
    const b = buildCacheObservability(
      inputs({
        serializedHistory: '',
        interveningMessagesText: ['<prior/>', 'h1', 'DIFFERENT newest'],
        shippedHistoryCount: 2,
      })
    );

    // This assertion reddens if the newest entry is left in the stable hash.
    expect(a.promptHashHistoryStable).toBe(b.promptHashHistoryStable);
    expect(a.promptHashFull).not.toBe(b.promptHashFull);
  });

  it('omits promptHashHistoryStable on a flag-on cross-channel-only turn', () => {
    const fields = buildCacheObservability(
      inputs({
        serializedHistory: '',
        interveningMessagesText: ['<prior/>'],
        shippedHistoryCount: 0,
      })
    );
    // Dropping the last element here would have dropped the cross-channel
    // message rather than a history entry — the count is what prevents that.
    expect(fields.promptHashHistoryStable).toBeUndefined();
  });

  it('omits promptHashHistoryStable when flag-on and nothing shipped at all', () => {
    const fields = buildCacheObservability(
      inputs({
        serializedHistory: '',
        interveningMessagesText: undefined,
        shippedHistoryCount: 0,
      })
    );
    expect(fields.promptHashHistoryStable).toBeUndefined();
  });

  it('is defined (not undefined) for a lone shipped history message, mirroring flag-off', () => {
    const fields = buildCacheObservability(
      inputs({
        serializedHistory: '',
        interveningMessagesText: ['h1'],
        shippedHistoryCount: 1,
      })
    );
    expect(fields.promptHashHistoryStable).toBe(expectedHash(''));
    expect(fields.promptHashHistoryStable).toBeDefined();
  });

  it('prefers the flag-off serialized-history branch when both are available', () => {
    const args = inputs({
      interveningMessagesText: ['<prior/>', 'h1', 'h2'],
      shippedHistoryCount: 2,
    });
    const fields = buildCacheObservability(args);
    expect(fields.promptHashHistoryStable).toBe(
      expectedHash(historyStablePrefix(args.serializedHistory))
    );
  });

  it('includes the hit ratio only when both token counts are reported', () => {
    expect(
      buildCacheObservability(inputs({ cacheReadTokens: 250, inputTokens: 1000 })).cacheHitRatio
    ).toBe(0.25);
    expect(buildCacheObservability(inputs({ inputTokens: 1000 })).cacheHitRatio).toBeUndefined();
  });

  it('emits everything through the caller-supplied logger, message last', () => {
    const info = vi.fn();
    const logger = { info } as unknown as Logger;
    const args = inputs({ cacheReadTokens: 300, inputTokens: 1200 });

    logGeneratedResponse(logger, {
      charCount: 42,
      personalityName: 'Ada',
      modelName: 'test-model',
      ...args,
    });

    expect(info).toHaveBeenCalledTimes(1);
    const [fields, message] = info.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toBe('Generated response');
    expect(fields).toMatchObject({
      charCount: 42,
      personalityName: 'Ada',
      modelName: 'test-model',
      // The grepped pair keeps its historical names and values.
      promptTokens: 1200,
      cachedPromptTokens: 300,
      cacheHitRatio: 0.25,
      ...buildCacheObservability(args),
    });
    // Raw inputs must not leak onto the log object.
    expect(fields).not.toHaveProperty('systemPromptText');
    expect(fields).not.toHaveProperty('serializedHistory');
    expect(fields).not.toHaveProperty('history');
  });

  it('carries no prompt text in any emitted field', () => {
    const fields = buildCacheObservability(inputs({ cacheReadTokens: 10, inputTokens: 100 }));

    for (const value of Object.values(fields)) {
      expect(typeof value === 'string' ? /^[0-9a-f]{12}$/.test(value) : true).toBe(true);
    }
  });
});
