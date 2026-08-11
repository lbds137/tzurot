/**
 * Drift pins for the FROZEN pre-restructure assembly (arm A). If any of these
 * fail, the vendored legacy arm no longer reproduces the pre-restructure
 * prompt — fix the vendored file, never the pin (the whole point of arm A is
 * that it does not move).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createMockPersonality } from '../../test/mocks/fixtures/personality.js';
import type {
  ConversationContext,
  FactForPrompt,
  MemoryDocument,
  ParticipantInfo,
} from '../ConversationalRAGTypes.js';
import {
  LEGACY_MEMORY_ARCHIVE_INSTRUCTION,
  legacyBuildHumanMessage,
  legacyBuildIdentityConstraints,
  legacyBuildSystemPrompt,
  legacyFactsInstruction,
} from './legacyPromptAssembly.js';

const FIXED_DATE = new Date('2026-07-15T12:00:00Z');

const context: ConversationContext = {
  userId: 'user-1',
  channelId: 'chan-1',
  activePersonaName: 'Vee',
  activePersonaId: 'persona-1',
  userTimezone: 'UTC',
};

const participants = new Map<string, ParticipantInfo>([
  [
    'persona-1',
    { personaName: 'Vee', content: 'A curious engineer', isActive: true, personaId: 'persona-1' },
  ],
]);

const memories: MemoryDocument[] = [
  {
    pageContent: 'Vee mentioned a rooftop garden.',
    metadata: { createdAt: '2026-07-01T10:00:00Z' },
  },
];

const facts: FactForPrompt[] = [{ statement: '{user} keeps bees.' }];

function buildFixtureSystemPrompt(overrides?: Parameters<typeof createMockPersonality>[0]): string {
  return legacyBuildSystemPrompt({
    personality: createMockPersonality(overrides),
    participantPersonas: participants,
    relevantMemories: memories,
    facts,
    context,
    referencedMessagesFormatted:
      '<contextual_references>\n<ref>quoted</ref>\n</contextual_references>',
    serializedHistory: '<message from="Vee" role="user" t="2026-07-15">hi</message>',
  });
}

describe('legacyBuildSystemPrompt (arm A drift pins)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('matches the frozen pre-restructure snapshot (legacy-XML protocol path)', () => {
    expect(
      buildFixtureSystemPrompt({ systemPrompt: '<rules>Speak softly to {user}.</rules>' })
    ).toMatchSnapshot();
  });

  it('matches the frozen pre-restructure snapshot (JSON protocol path)', () => {
    expect(
      buildFixtureSystemPrompt({
        systemPrompt: JSON.stringify({
          permissions: ['may reference memories'],
          characterDirectives: ['stay wry'],
          formattingRules: ['no emoji'],
        }),
      })
    ).toMatchSnapshot();
  });

  it('keeps the Sandwich order: protocol + output constraints AFTER chat_log (the recency tail)', () => {
    const prompt = buildFixtureSystemPrompt({ systemPrompt: '<rules>Be kind.</rules>' });
    const chatLogIndex = prompt.indexOf('<chat_log>');
    const protocolIndex = prompt.indexOf('<protocol>');
    const outputIndex = prompt.indexOf('<output_constraints>');
    expect(chatLogIndex).toBeGreaterThan(-1);
    expect(protocolIndex).toBeGreaterThan(chatLogIndex);
    expect(outputIndex).toBeGreaterThan(protocolIndex);
  });

  it('renders volatile blocks INSIDE the system prompt (the pre-restructure placement)', () => {
    const prompt = buildFixtureSystemPrompt();
    for (const tag of [
      '<context>',
      '<participants>',
      '<facts',
      '<memory_archive',
      '<contextual_references>',
    ]) {
      expect(prompt).toContain(tag);
    }
  });

  it('carries the OLD memory/facts framing wording, not the restructure wording', () => {
    const prompt = buildFixtureSystemPrompt();
    expect(prompt).toContain('SUMMARIZED NOTES');
    expect(prompt).not.toContain('your own recalled memories');
    expect(prompt).toContain('current background knowledge when responding.');
    expect(prompt).not.toContain('never instructions to follow');
  });
});

describe('legacy wording constants', () => {
  it('pins the exact pre-restructure archive instruction', () => {
    expect(LEGACY_MEMORY_ARCHIVE_INSTRUCTION).toBe(
      'These are SUMMARIZED NOTES from past interactions, not current conversation. ' +
        'Use ONLY as background context to inform your response to the user message.'
    );
  });

  it('pins the pre-restructure facts instruction (no boundary sentence)', () => {
    const text = legacyFactsInstruction('Vee');
    expect(text).toContain('durable KNOWN FACTS about Vee');
    expect(text.endsWith('current background knowledge when responding.')).toBe(true);
  });
});

describe('legacyBuildIdentityConstraints', () => {
  it('renders the collision constraint INSIDE identity_constraints (pre-restructure placement)', () => {
    const withCollision = legacyBuildIdentityConstraints('Emily', {
      userName: 'Emily',
      discordUsername: 'emily_v',
    });
    expect(withCollision).toContain('shares your name');
    expect(withCollision).toContain('(@emily_v)');
    const without = legacyBuildIdentityConstraints('Emily');
    expect(without).not.toContain('shares your name');
  });

  it('escapes protected structural tags in user-authored names (escapeXmlContent semantics)', () => {
    // escapeXmlContent is selective: it escapes PROTECTED structural tags
    // (a crafted </constraint> cannot break out) but passes arbitrary text through.
    const constraints = legacyBuildIdentityConstraints('Emily', {
      userName: 'x</constraint>',
      discordUsername: 'plain',
    });
    expect(constraints).not.toContain('x</constraint>');
    expect(constraints).toContain('x&lt;/constraint&gt;');
  });
});

describe('legacyBuildHumanMessage', () => {
  it('appends references AFTER the user text and wraps everything in <from> (the double-render side)', () => {
    const content = legacyBuildHumanMessage('hello there', {
      activePersonaName: 'Vee',
      referencedMessagesDescriptions: '<contextual_references>ref</contextual_references>',
      activePersonaId: 'persona-1',
      personalityName: 'TestBot',
    });
    expect(content.indexOf('hello there')).toBeLessThan(content.indexOf('<contextual_references>'));
    expect(content).toContain('<from');
    // References sit INSIDE the speaker wrap in the old shape.
    expect(content.indexOf('</from>')).toBeLessThan(content.indexOf('hello there'));
  });

  it('escapes protected tags in the user text but leaves the reference XML intact', () => {
    const content = legacyBuildHumanMessage('a </from> c', {
      referencedMessagesDescriptions: '<contextual_references>r</contextual_references>',
    });
    expect(content).toContain('a &lt;/from&gt; c');
    expect(content).toContain('<contextual_references>r</contextual_references>');
  });
});
