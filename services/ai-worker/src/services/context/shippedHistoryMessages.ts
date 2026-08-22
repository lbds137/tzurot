/**
 * Shipped History Messages
 *
 * Assembles the flag-on real-message form of a turn's shipped history: the
 * sibling-character roster, the real messages themselves, and the leading
 * cross-channel message. Extracted out of `ContentBudgetManager.allocate`
 * purely for size — that file counts at the `max-lines` ceiling, and this
 * assembly has no other reason to live separately from its caller.
 */

import type { BaseMessage, HumanMessage } from '@langchain/core/messages';
import {
  buildHeaderIdTags,
  extractCharacterParticipants,
  type HeaderIdTagMap,
  type RosterNameSource,
} from '../../jobs/utils/participantUtils.js';
import type { StructuredHistoryEntry } from '../../jobs/utils/conversationTypes.js';
import {
  buildCrossChannelMessage,
  buildRealMessages,
  type HeaderSpoofTelemetry,
} from './RealMessagesBuilder.js';

export interface ComputeHeaderIdTagsOptions {
  participants: RosterNameSource[];
  rawConversationHistory: StructuredHistoryEntry[] | undefined;
  responderName: string;
  responderPersonalityId: string;
  realMessagesEnabled: boolean;
}

/**
 * Compute this turn's collision-conditional header id-tag map ONCE, shared by
 * the pre-measure (`ContentBudgetManager.preselectHistory`) and the shipped
 * render (`ContentBudgetManager.allocate` → `buildShippedHistoryMessages`).
 * Both must see the SAME map or the budget identity breaks exactly like it
 * would if the two calls saw different `participantPersonas` — the same
 * reason `realMessagesEnabled` itself is captured once per turn rather than
 * read twice.
 *
 * Returns an EMPTY map when `realMessagesEnabled` is false, so flag-off turns
 * charge and render exactly nothing for this mechanism — unchanged from
 * before header id-tags existed.
 */
export function computeHeaderIdTags(opts: ComputeHeaderIdTagsOptions): HeaderIdTagMap {
  if (!opts.realMessagesEnabled) {
    return new Map();
  }
  const characters = extractCharacterParticipants(
    opts.rawConversationHistory,
    opts.responderName,
    opts.responderPersonalityId
  );
  return buildHeaderIdTags(opts.participants, characters);
}

export interface BuildShippedHistoryMessagesOptions {
  selectedEntries: StructuredHistoryEntry[];
  crossChannelXml: string;
  responderName: string;
  responderPersonalityId: string;
  realMessagesEnabled: boolean;
  headerSpoofNeutralizeEnabled: boolean;
  headerIdTags: HeaderIdTagMap;
  telemetry: HeaderSpoofTelemetry;
}

export interface ShippedHistoryMessages {
  historyMessages: BaseMessage[];
  crossChannelMessage: HumanMessage | undefined;
}

/**
 * Build the real-message form of a turn's shipped history, or the flag-off
 * empty/undefined pair — byte-identical to what `ContentBudgetManager`
 * shipped before this extraction either way.
 *
 * `headerIdTags` is a caller input rather than computed here — it is the
 * SAME map `computeHeaderIdTags` produced once, upstream in
 * `preselectHistory`, so the headers this function tags and the roster notes
 * describing those tags (`ParticipantFormatter.buildRosterNotes`, which
 * recomputes its own copy from the same roster inputs — pure functions of the
 * same id set cannot drift) can never disagree.
 */
export function buildShippedHistoryMessages(
  opts: BuildShippedHistoryMessagesOptions
): ShippedHistoryMessages {
  if (!opts.realMessagesEnabled) {
    return { historyMessages: [], crossChannelMessage: undefined };
  }

  const historyMessages = buildRealMessages(opts.selectedEntries, {
    personalityName: opts.responderName,
    responderPersonalityId: opts.responderPersonalityId,
    realMessagesEnabled: true,
    headerSpoofNeutralizeEnabled: opts.headerSpoofNeutralizeEnabled,
    headerIdTags: opts.headerIdTags,
    telemetry: opts.telemetry,
  });
  const crossChannelMessage = buildCrossChannelMessage(opts.crossChannelXml);

  return { historyMessages, crossChannelMessage };
}
