import { describe, it, expect } from 'vitest';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { buildShippedHistoryMessages, computeHeaderIdTags } from './shippedHistoryMessages.js';
import { formatParticipantsContext } from '../prompt/ParticipantFormatter.js';
import type { ParticipantInfo } from '../ConversationalRAGTypes.js';
import type { StructuredHistoryEntry } from '../../jobs/utils/conversationTypes.js';
import type { RosterNameSource } from '../../jobs/utils/participantUtils.js';

const RESPONDER_NAME = 'TestBot';
const RESPONDER_ID = 'personality-testbot';

describe('computeHeaderIdTags', () => {
  it('flag-off returns an empty map regardless of roster collisions', () => {
    const participants: RosterNameSource[] = [
      { personaId: 'p-1', personaName: 'Lila' },
      { personaId: 'p-2', personaName: 'Lila' },
    ];

    const map = computeHeaderIdTags({
      participants,
      rawConversationHistory: undefined,
      responderName: RESPONDER_NAME,
      responderPersonalityId: RESPONDER_ID,
      realMessagesEnabled: false,
    });

    expect(map.size).toBe(0);
  });

  it('flag-on with a non-colliding roster returns an empty map', () => {
    const participants: RosterNameSource[] = [{ personaId: 'p-1', personaName: 'Vlad' }];

    const map = computeHeaderIdTags({
      participants,
      rawConversationHistory: undefined,
      responderName: RESPONDER_NAME,
      responderPersonalityId: RESPONDER_ID,
      realMessagesEnabled: true,
    });

    expect(map.size).toBe(0);
  });

  it('flag-on with a colliding roster returns a flat id -> tag map', () => {
    const participants: RosterNameSource[] = [
      { personaId: 'a1b2c3d4-0000-0000-0000-000000000001', personaName: 'Lila' },
      { personaId: 'ffffffff-0000-0000-0000-000000000002', personaName: 'Lila' },
    ];

    const map = computeHeaderIdTags({
      participants,
      rawConversationHistory: undefined,
      responderName: RESPONDER_NAME,
      responderPersonalityId: RESPONDER_ID,
      realMessagesEnabled: true,
    });

    expect(map.get('a1b2c3d4-0000-0000-0000-000000000001')).toBe('a1b2');
    expect(map.get('ffffffff-0000-0000-0000-000000000002')).toBe('ffff');
  });

  it('includes sibling characters extracted from raw history in the collision set', () => {
    const participants: RosterNameSource[] = [
      { personaId: 'aaaaaaaa-0000-0000-0000-000000000001', personaName: 'Kai' },
    ];
    const rawConversationHistory: StructuredHistoryEntry[] = [
      {
        role: 'assistant',
        content: 'hi',
        personalityId: 'bbbbbbbb-0000-0000-0000-000000000002',
        personalityName: 'Kai',
      },
    ];

    const map = computeHeaderIdTags({
      participants,
      rawConversationHistory,
      responderName: RESPONDER_NAME,
      responderPersonalityId: RESPONDER_ID,
      realMessagesEnabled: true,
    });

    expect(map.get('aaaaaaaa-0000-0000-0000-000000000001')).toBe('aaaa');
    expect(map.get('bbbbbbbb-0000-0000-0000-000000000002')).toBe('bbbb');
  });
});

describe('roster note <-> shipped header agreement', () => {
  it('the note fires iff the same roster inputs produce tagged headers', () => {
    // The two halves recompute the map independently (ParticipantFormatter
    // for the note wording, computeHeaderIdTags for the shipped headers) on
    // the pure-functions-cannot-drift argument. This is the one test that
    // holds BOTH halves to the same fixture: if a refactor lets their
    // participant/character inputs diverge, the note's claim ("headers ...
    // carry an (id:xxxx) tag") desyncs from the headers actually shipped and
    // this reddens.
    const participants: ParticipantInfo[] = [
      { personaId: 'aaaa1111-0000-0000-0000-000000000001', personaName: 'Lila', content: '' },
      { personaId: 'bbbb2222-0000-0000-0000-000000000002', personaName: 'Lila', content: '' },
    ] as never;
    const participantMap = new Map(participants.map(p => [p.personaId, p]));

    const roster = formatParticipantsContext(participantMap, RESPONDER_NAME, [], {}, true);
    expect(roster).toContain('carry an (id:xxxx) tag');

    const map = computeHeaderIdTags({
      participants,
      rawConversationHistory: undefined,
      responderName: RESPONDER_NAME,
      responderPersonalityId: RESPONDER_ID,
      realMessagesEnabled: true,
    });
    const entries: StructuredHistoryEntry[] = [
      {
        role: 'user',
        content: 'hi',
        personaId: 'aaaa1111-0000-0000-0000-000000000001',
        personaName: 'Lila',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const { historyMessages } = buildShippedHistoryMessages({
      selectedEntries: entries,
      crossChannelXml: '',
      responderName: RESPONDER_NAME,
      responderPersonalityId: RESPONDER_ID,
      realMessagesEnabled: true,
      headerIdTags: map,
      headerSpoofNeutralizeEnabled: false,
      telemetry: {},
    });
    const header = String(historyMessages[0]?.content).split('\n')[0];
    expect(header).toContain('(id:aaaa)');
  });
});

describe('buildShippedHistoryMessages', () => {
  it('flag-off returns an empty history-message list and no cross-channel message', () => {
    const selectedEntries: StructuredHistoryEntry[] = [
      { role: 'user', content: 'hi', personaId: 'p-1', personaName: 'Vlad' },
    ];

    const result = buildShippedHistoryMessages({
      selectedEntries,
      crossChannelXml:
        '<prior_conversations>\n<channel_history></channel_history>\n</prior_conversations>',
      responderName: RESPONDER_NAME,
      responderPersonalityId: RESPONDER_ID,
      realMessagesEnabled: false,
      headerIdTags: new Map(),
      headerSpoofNeutralizeEnabled: false,
      telemetry: {},
    });

    expect(result.historyMessages).toEqual([]);
    expect(result.crossChannelMessage).toBeUndefined();
  });

  it('flag-on with a colliding headerIdTags map produces tagged headers', () => {
    const selectedEntries: StructuredHistoryEntry[] = [
      {
        role: 'user',
        content: 'hi',
        personaId: 'a1b2c3d4-0000-0000-0000-000000000001',
        personaName: 'Lila',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const headerIdTags = computeHeaderIdTags({
      participants: [
        { personaId: 'a1b2c3d4-0000-0000-0000-000000000001', personaName: 'Lila' },
        { personaId: 'ffffffff-0000-0000-0000-000000000002', personaName: 'Lila' },
      ],
      rawConversationHistory: undefined,
      responderName: RESPONDER_NAME,
      responderPersonalityId: RESPONDER_ID,
      realMessagesEnabled: true,
    });

    const result = buildShippedHistoryMessages({
      selectedEntries,
      crossChannelXml: '',
      responderName: RESPONDER_NAME,
      responderPersonalityId: RESPONDER_ID,
      realMessagesEnabled: true,
      headerSpoofNeutralizeEnabled: false,
      headerIdTags,
      telemetry: {},
    });

    expect(result.historyMessages).toHaveLength(1);
    expect(String(result.historyMessages[0].content)).toContain('(id:a1b2)');
    expect(result.historyMessages[0]).toBeInstanceOf(HumanMessage);
  });

  it('flag-on with an empty headerIdTags map produces untagged headers', () => {
    const selectedEntries: StructuredHistoryEntry[] = [
      {
        role: 'assistant',
        content: 'hello',
        personalityId: RESPONDER_ID,
        personalityName: RESPONDER_NAME,
      },
    ];

    const result = buildShippedHistoryMessages({
      selectedEntries,
      crossChannelXml: '',
      responderName: RESPONDER_NAME,
      responderPersonalityId: RESPONDER_ID,
      realMessagesEnabled: true,
      headerIdTags: new Map(),
      headerSpoofNeutralizeEnabled: false,
      telemetry: {},
    });

    expect(result.historyMessages).toHaveLength(1);
    expect(result.historyMessages[0]).toBeInstanceOf(AIMessage);
    expect(String(result.historyMessages[0].content)).not.toContain('(id:');
  });

  it('the cross-channel message is present only when the XML is non-empty', () => {
    const present = buildShippedHistoryMessages({
      selectedEntries: [],
      crossChannelXml: '<prior_conversations>content</prior_conversations>',
      responderName: RESPONDER_NAME,
      responderPersonalityId: RESPONDER_ID,
      realMessagesEnabled: true,
      headerIdTags: new Map(),
      headerSpoofNeutralizeEnabled: false,
      telemetry: {},
    });
    expect(present.crossChannelMessage).toBeInstanceOf(HumanMessage);
    expect(present.crossChannelMessage?.content).toBe(
      '<prior_conversations>content</prior_conversations>'
    );

    const absent = buildShippedHistoryMessages({
      selectedEntries: [],
      crossChannelXml: '',
      responderName: RESPONDER_NAME,
      responderPersonalityId: RESPONDER_ID,
      realMessagesEnabled: true,
      headerIdTags: new Map(),
      headerSpoofNeutralizeEnabled: false,
      telemetry: {},
    });
    expect(absent.crossChannelMessage).toBeUndefined();
  });
});
