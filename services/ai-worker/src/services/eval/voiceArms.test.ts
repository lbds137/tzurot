/**
 * Arm-construction pins for the voice-consistency harness. The load-bearing
 * property is the PAIRED design: every arm consumes byte-identical content
 * inputs — only arrangement differs. If cross-arm invariance breaks, the
 * comparison stops being an experiment about assembly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createMockPersonality } from '../../test/mocks/fixtures/personality.js';
import { PLATFORM_CONSTRAINTS, OUTPUT_CONSTRAINTS } from '../prompt/HardcodedConstraints.js';
import type { ConversationContext, ParticipantInfo } from '../ConversationalRAGTypes.js';
import {
  ARM_IDS,
  buildArmMessages,
  moveOutputConstraintsToTail,
  type ProbeInputs,
} from './voiceArms.js';

const FIXED_DATE = new Date('2026-07-15T12:00:00Z');
const HISTORY = '<message from="Vee" role="user" t="2026-07-14">the rooftop plan</message>';
const MEMORY_TEXT = 'Vee mentioned a rooftop garden.';
const USER_TURN = 'so what should we plant first?';
const REFERENCES = '<contextual_references>\n<ref>the seed catalog</ref>\n</contextual_references>';

function buildInputs(): ProbeInputs {
  const context: ConversationContext = {
    userId: 'user-1',
    channelId: 'chan-1',
    activePersonaName: 'Vee',
    activePersonaId: 'persona-1',
    userTimezone: 'UTC',
  };
  const participantPersonas = new Map<string, ParticipantInfo>([
    [
      'persona-1',
      { personaName: 'Vee', content: 'A curious engineer', isActive: true, personaId: 'persona-1' },
    ],
  ]);
  return {
    personality: createMockPersonality({ systemPrompt: '<rules>Stay wry with {user}.</rules>' }),
    context,
    participantPersonas,
    serializedHistory: HISTORY,
    relevantMemories: [
      { pageContent: MEMORY_TEXT, metadata: { createdAt: '2026-07-01T10:00:00Z' } },
    ],
    facts: [{ statement: '{user} keeps bees.' }],
    referencedMessagesFormatted: REFERENCES,
    userMessage: USER_TURN,
  };
}

describe('voice arms', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cross-arm input invariance: every arm carries the same history, memory, and user-turn bytes', () => {
    const inputs = buildInputs();
    for (const arm of ARM_IDS) {
      const { system, human } = buildArmMessages(arm, inputs);
      const combined = `${system}\n${human}`;
      expect(combined, `arm ${arm} lost the chat log`).toContain(HISTORY);
      expect(combined, `arm ${arm} lost the memory text`).toContain(MEMORY_TEXT);
      expect(combined, `arm ${arm} lost the user turn`).toContain(USER_TURN);
      expect(combined, `arm ${arm} lost the references`).toContain('the seed catalog');
    }
  });

  it('arm A: single-container system with volatiles inside and protocol/output on the recency tail', () => {
    const { system } = buildArmMessages('A', buildInputs());
    // Closing forms for the two tags OUTPUT_CONSTRAINTS names in its
    // scaffolding-ban rule: their opening tags sit in every system message as
    // static ban text, so asserting on those would pass without arm A ever
    // rendering the blocks. The closers come only from the rendered blocks.
    for (const tag of [
      '</context>',
      '<participants>',
      '<memory_archive',
      '</contextual_references>',
    ]) {
      expect(system).toContain(tag);
    }
    const chatLog = system.indexOf('<chat_log>');
    expect(system.indexOf('<protocol>')).toBeGreaterThan(chatLog);
    expect(system.indexOf('<output_constraints>')).toBeGreaterThan(system.indexOf('<protocol>'));
  });

  it('arm A: references double-render (system section AND human append) — the old waste, preserved deliberately', () => {
    const { system, human } = buildArmMessages('A', buildInputs());
    expect(system).toContain('the seed catalog');
    expect(human).toContain('the seed catalog');
  });

  it('arm B: system is the S0/S1/H prefix with NO volatile blocks; the human message carries them', () => {
    const { system, human } = buildArmMessages('B', buildInputs());
    expect(system.startsWith(`${PLATFORM_CONSTRAINTS}\n\n${OUTPUT_CONSTRAINTS}`)).toBe(true);
    // (<contextual_references> is checked by CONTENT below — the tag NAME
    // legitimately appears inside OUTPUT_CONSTRAINTS' scaffolding-ban rule.)
    // <context> is in that ban rule too, so its OPENING tag is present in every
    // system message as static S0 text; the closing form is emitted only by the
    // rendered volatile block, which is what this arm is asserting about.
    for (const tag of ['</context>', '<memory_archive', '<facts']) {
      expect(system).not.toContain(tag);
      expect(human).toContain(tag);
    }
    // The roster and the location sit on the SYSTEM side — both are stable for
    // the channel. Pinned in the same loop shape as the volatile tags so an
    // arm-pairing regression that moves them cannot pass silently.
    for (const tag of ['<participants>', '<location']) {
      expect(system).toContain(tag);
      expect(human).not.toContain(tag);
    }
    expect(human).toContain('<contextual_references>');
    // References render ONCE in B.
    expect(system).not.toContain('the seed catalog');
  });

  it('arm framing wording: A carries the old framing, B the restructure framing', () => {
    const a = buildArmMessages('A', buildInputs());
    const b = buildArmMessages('B', buildInputs());
    expect(a.system).toContain('SUMMARIZED NOTES');
    expect(b.human).toContain('your own recalled memories');
    expect(b.human).not.toContain('SUMMARIZED NOTES');
  });

  it('arm B2 is byte-identical to arm B (the sampling-noise control differs only at generation)', () => {
    const inputs = buildInputs();
    expect(buildArmMessages('B2', inputs)).toEqual(buildArmMessages('B', inputs));
  });

  it('arm C differs from B ONLY by OUTPUT_CONSTRAINTS position (prefix → tail)', () => {
    const inputs = buildInputs();
    const b = buildArmMessages('B', inputs);
    const c = buildArmMessages('C', inputs);
    expect(c.human).toBe(b.human);
    expect(c.system.endsWith(`\n\n${OUTPUT_CONSTRAINTS}`)).toBe(true);
    // Reconstruct: removing the block from both leaves identical remainders.
    const stripped = (text: string): string =>
      text
        .replace(`${OUTPUT_CONSTRAINTS}`, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    expect(stripped(c.system)).toBe(stripped(b.system));
  });

  it('arm C transform hard-errors when B stops matching the expected S0 prefix shape', () => {
    expect(() => moveOutputConstraintsToTail('<something_else>')).toThrow(
      /update the remedy transform/
    );
  });
});
