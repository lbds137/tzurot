/**
 * Real Messages Builder
 *
 * Renders a selected conversation-history window as real LangChain messages
 * (PR 2.3 of the prompt-assembly epic, `docs/proposals/backlog/prompt-assembly-architecture.md`
 * §2.3), behind the `realMessagesEnabled` runtime flag. Reuses the XML path's
 * speaker resolution (`resolveSpeakerInfo`) and entry-body renderer
 * (`renderHistoryEntryBody`) so the two containers describe one history
 * identically — this module owns only the ENVELOPE difference: a header line
 * + role assignment instead of XML attributes, and `additional_kwargs` for
 * machine-readable identity.
 */

import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { formatAbsoluteTimestamp } from '@tzurot/common-types/utils/dateFormatting';
import { calculateTimeGap, formatTimeGap, shouldShowGap } from '@tzurot/common-types/utils/timeGap';
import {
  buildHistoryEntryIndex,
  collectPersonalityNames,
  renderHistoryEntryBody,
} from '../../jobs/utils/conversationUtils.js';
import { resolveSpeakerInfo, type ChatLogRole } from '../../jobs/utils/participantUtils.js';
import type { StructuredHistoryEntry } from '../../jobs/utils/conversationTypes.js';

/**
 * Identity + role metadata carried on every history message's
 * `additional_kwargs` (§2.3 council: "text headers are for the model, kwargs
 * are for the machine"). `speakerId` is the identity key kwargs must carry
 * (§9c) — `personalityId` for an assistant/character row, `personaId` for a
 * user row — never a name, which drifts on rename.
 */
export interface HistoryMessageKwargs {
  speakerId?: string;
  isAi: boolean;
  discordMessageId?: string[];
  /**
   * Rides on EVERY message, assistant included, so the kwargs shape is
   * uniform even though an assistant row carries no header line. This is the
   * ONLY place an assistant row's timestamp survives: §9c's council pass
   * (Q2) sent assistant self-timestamps kwargs-only, on imitation-risk
   * grounds — teaching the model its own `[Name — t]` header by example is
   * exactly the header-leakage risk the new S0 constraint (D6a) forbids.
   */
  timestamp?: string;
  [key: string]: unknown;
}

/** speakerId for kwargs: persona id for a user row, personality id otherwise. */
function speakerIdFor(msg: StructuredHistoryEntry, role: ChatLogRole): string | undefined {
  return role === 'user' ? msg.personaId : msg.personalityId;
}

/**
 * Neutralize header-forgery characters in a speaker name. The bracket header
 * is the ONLY structural signal separating "who said what" once history rides
 * as plain-text turns, and persona/personality names are unrestricted beyond
 * length — a crafted name containing `]`, `[`, or a newline could close the
 * header early and forge additional `[Name — timestamp]` turns inside one
 * message. Same threat the XML path answers with `escapeXml` on the `from=`
 * attribute; here brackets become parentheses and line breaks become spaces,
 * which keeps the name readable instead of entity-escaped.
 */
function sanitizeHeaderName(speakerName: string): string {
  return speakerName
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/[\r\n]+/g, ' ');
}

/** The `[Name — timestamp]` header, or `[Name]` when the entry has no usable timestamp. */
function buildHeaderLine(speakerName: string, createdAt: string | undefined): string {
  const safeName = sanitizeHeaderName(speakerName);
  if (createdAt === undefined || createdAt.length === 0) {
    return `[${safeName}]`;
  }
  return `[${safeName} — ${formatAbsoluteTimestamp(createdAt)}]`;
}

/**
 * The time-gap line for the zone above the NEXT message's header (or, for an
 * assistant message with no header, the message's own first line) — computed
 * with the SAME threshold machinery the XML path's `maybeAddTimeGapMarker`
 * calls (`calculateTimeGap`/`shouldShowGap`/`formatTimeGap`), not a
 * re-derived rule. The FORM differs deliberately: a plain bracketed line, not
 * `formatTimeGapMarker`'s `<time_gap />` XML — real messages carry no XML
 * scaffolding, and the S0 header-leakage constraint tells the model not to
 * emit bracket-form platform lines, which an XML element is not covered by.
 * Note this is a behavioral ADDITION relative to the shipped XML path: no
 * production call site passes a `TimeGapConfig`, so the XML path emits no
 * gap markers today, while this path emits them at the default 1-hour
 * threshold — §2.3 specifies gap lines as part of the real-messages shape.
 */
function gapLineFor(
  previousTimestamp: string | undefined,
  currentTimestamp: string | undefined
): string | undefined {
  if (previousTimestamp === undefined || currentTimestamp === undefined) {
    return undefined;
  }
  const gapMs = calculateTimeGap(previousTimestamp, currentTimestamp);
  return shouldShowGap(gapMs) ? `[time gap: ${formatTimeGap(gapMs)}]` : undefined;
}

/**
 * Compose one entry's message content: an optional time-gap line, then (for
 * user/character) the `[Name — t]` header, then the shared body. An
 * assistant row carries no header — the assistant role already says whose
 * words these are (§2.3) — so a leading gap line is that message's first
 * line instead.
 */
function buildMessageContent(
  msg: StructuredHistoryEntry,
  speakerInfo: { speakerName: string; role: ChatLogRole; normalizedRole: string },
  body: string,
  gapLine: string | undefined
): string {
  const lines: string[] = [];
  if (gapLine !== undefined) {
    lines.push(gapLine);
  }
  if (speakerInfo.role !== 'assistant') {
    lines.push(buildHeaderLine(speakerInfo.speakerName, msg.createdAt));
  }
  lines.push(body);
  return lines.join('\n');
}

/**
 * Render an entry's body and decide whether the row should be skipped
 * entirely (an assistant row whose body renders empty — no metadata sections,
 * nothing to say). Shared by `buildRealMessages` and
 * `renderHistoryEntryForMeasure` so the skip decision cannot drift between
 * what gets SHIPPED and what gets MEASURED: both ask this same question of
 * the same body.
 *
 * Returns `null` for the skip case, the rendered body string otherwise
 * (including the legitimate empty-body case for a non-assistant row, which is
 * not a skip).
 */
function renderBodyOrSkip(
  msg: StructuredHistoryEntry,
  speakerInfo: { speakerName: string; role: ChatLogRole; normalizedRole: string },
  opts: {
    personalityName: string;
    historyEntries?: Map<string, StructuredHistoryEntry>;
    allPersonalityNames?: Set<string>;
    responderPersonalityId?: string;
  }
): string | null {
  const body = renderHistoryEntryBody(msg, speakerInfo, opts);
  if (speakerInfo.role === 'assistant' && body.length === 0) {
    // An assistant row with a blanked body and no metadata sections has
    // nothing to say (user/character rows always carry a header line, so
    // only assistant rows can reach this). The XML path ships an empty
    // <message/> element here, a shape only an XML document can carry — and
    // provider APIs are not verified to accept an empty-content message (some
    // reject it). Skip the row.
    return null;
  }
  return body;
}

/**
 * The measure-form render of one history entry: the same body-rendering
 * pipeline `buildRealMessages` uses per entry, WITHOUT the two per-window
 * inputs that only exist once a window is being SHIPPED rather than sized —
 * the dedup index (`historyEntries: undefined`, the same documented
 * convention `measureHistoryEntryTokens` states: budget callers are choosing
 * WHICH entries ship, so the shipped-id set does not exist yet) and the
 * inter-message gap line (a budget measures entries independently, one at a
 * time; `historyTokenMeasure.ts` charges a separate worst-case gap-line
 * constant instead, since whether THIS entry would actually pay one depends
 * on a neighbour the per-entry measure cannot see).
 *
 * Returns '' for a row `resolveSpeakerInfo` declines and for the
 * assistant-empty-body skip — both match what the real-message render would
 * actually ship (nothing), which is the contract `measureHistoryEntryTokens`
 * documents for the XML form.
 */
export function renderHistoryEntryForMeasure(
  msg: StructuredHistoryEntry,
  personalityName: string,
  allPersonalityNames?: Set<string>,
  responderPersonalityId?: string
): string {
  const speakerInfo = resolveSpeakerInfo(
    msg,
    personalityName,
    allPersonalityNames,
    responderPersonalityId
  );
  if (speakerInfo === null) {
    return '';
  }

  const body = renderBodyOrSkip(msg, speakerInfo, {
    personalityName,
    historyEntries: undefined,
    allPersonalityNames,
    responderPersonalityId,
  });
  if (body === null) {
    return '';
  }

  return buildMessageContent(msg, speakerInfo, body, undefined);
}

/**
 * Build the real-message form of a selected history window: one
 * `HumanMessage`/`AIMessage` per entry, in chronological order (the same
 * order `selectedEntries` already arrives in — see
 * `ContextWindowManager.selectCurrentChannelEntries`'s newest-first walk with
 * `unshift`).
 *
 * A row `resolveSpeakerInfo` declines (a `system`/unknown role) contributes
 * no message — the same skip the XML path applies.
 *
 * Deliberately NO merging of consecutive same-role messages (§2.3, resolved
 * by fact-check: the current API set auto-combines same-role turns
 * server-side where required, and doing it ourselves would cost Discord's
 * rapid-fire rhythm cues and cache-prefix granularity). A live probe
 * confirmed z.ai-direct and OpenRouter both accept and reason over
 * consecutive `user` messages (record: prompt-assembly-architecture.md §9c).
 * If a future provider in this stack DOES require alternation, the
 * merge belongs at this per-entry push — the seam is named here so it has an
 * obvious home rather than being invented at the call site.
 */
export function buildRealMessages(
  selectedEntries: StructuredHistoryEntry[],
  personalityName: string,
  responderPersonalityId?: string
): BaseMessage[] {
  if (selectedEntries.length === 0) {
    return [];
  }

  // Scoped to the SELECTED window, matching the XML path's shipped-render
  // scope exactly (`formatConversationHistoryAsXml` builds both from its
  // `history` parameter, which is the same selected subset at the call site
  // in `ContextWindowManager.selectCurrentChannelEntries`).
  const historyEntries = buildHistoryEntryIndex(selectedEntries);
  const allPersonalityNames = collectPersonalityNames(selectedEntries, personalityName);

  const messages: BaseMessage[] = [];
  let previousTimestamp: string | undefined;

  for (const msg of selectedEntries) {
    const speakerInfo = resolveSpeakerInfo(
      msg,
      personalityName,
      allPersonalityNames,
      responderPersonalityId
    );
    if (speakerInfo === null) {
      continue;
    }

    const gapLine = gapLineFor(previousTimestamp, msg.createdAt);
    // Checked on the BODY, before the gap line joins: a >1h gap must not
    // rescue an otherwise-empty row into a gap-marker-only AIMessage. The gap
    // baseline below stays on the last message the model actually sees.
    const body = renderBodyOrSkip(msg, speakerInfo, {
      personalityName,
      historyEntries,
      allPersonalityNames,
      responderPersonalityId,
    });
    if (body === null) {
      continue;
    }
    const content = buildMessageContent(msg, speakerInfo, body, gapLine);

    const kwargs: HistoryMessageKwargs = {
      speakerId: speakerIdFor(msg, speakerInfo.role),
      isAi: speakerInfo.role !== 'user',
      discordMessageId: msg.discordMessageId,
      timestamp: msg.createdAt,
    };

    messages.push(
      speakerInfo.role === 'assistant'
        ? new AIMessage({ content, additional_kwargs: kwargs })
        : new HumanMessage({ content, additional_kwargs: kwargs })
    );

    // Only a rendered entry advances the gap baseline — the null-speaker skip
    // mirrors `formatConversationHistoryAsXml`, and the empty-content skip
    // above (new to this path) deliberately behaves the same way: the next
    // gap line measures from the last message the model actually SEES, not
    // from a row that rendered nothing.
    if (msg.createdAt !== undefined) {
      previousTimestamp = msg.createdAt;
    }
  }

  return messages;
}

/**
 * The `<prior_conversations>` XML as its own leading `HumanMessage` (§9c
 * council-adopted refinement of §2.3): cross-channel history renders BEFORE
 * the current-channel real messages, in its own user-role turn, so S0+S1
 * stays 100% stable and cross-channel churn invalidates only from its own
 * position. Content ships VERBATIM — no re-serialization, no restructuring
 * (explicitly ruled out, §9c). Omitted entirely when the XML is empty
 * (cross-channel disabled, or nothing fit the budget).
 */
export function buildCrossChannelMessage(crossChannelXml: string): HumanMessage | undefined {
  return crossChannelXml.length > 0 ? new HumanMessage(crossChannelXml) : undefined;
}
