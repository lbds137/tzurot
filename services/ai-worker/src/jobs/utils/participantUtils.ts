/**
 * Participant Utilities
 *
 * Helper functions for extracting and processing conversation participants.
 * Extracted from conversationUtils.ts for better modularity.
 */

import { MessageRole, MESSAGE_LIMITS } from '@tzurot/common-types/constants/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { RawHistoryEntry } from './conversationTypes.js';

const logger = createLogger('participantUtils');

/** The role vocabulary rendered into `<message role="...">` chat-log attributes. */
export type ChatLogRole = 'user' | 'assistant' | 'character';

/**
 * Is an assistant-role row the RESPONDER's own line, or a sibling character's?
 *
 * Ids first. `personalityId` is stamped from the row's own personality and is
 * stable across renames, so when both sides carry one the answer is exact and
 * the name never enters into it. That closes a real defect: `personalityName`
 * is stamped at WRITE time, so renaming a personality past its old name's
 * prefix made its own history read as a different character — and since the
 * roster derives membership from this same decision, it also produced a
 * `<character_participant>` entry showing the personality to itself as a peer.
 *
 * The name comparison survives only as the fallback for rows with no id, which
 * is the case it was always really serving: the extended-context fetch's
 * registry-miss path stores a webhook DISPLAY name and no id. That fallback
 * stays prefix-bidirectional, with the known and tested cost that a sibling
 * whose name is a prefix of the responder's (or the reverse) reads as self.
 * Ids shrink how often that heuristic is consulted at all; they do not change
 * its behaviour where it still applies.
 */
function resolveAssistantRowRole(
  msg: RawHistoryEntry,
  speakerName: string,
  personalityName: string,
  responderPersonalityId?: string
): ChatLogRole {
  const rowId = msg.personalityId;
  if (
    rowId !== undefined &&
    rowId.length > 0 &&
    responderPersonalityId !== undefined &&
    responderPersonalityId.length > 0
  ) {
    return rowId === responderPersonalityId ? 'assistant' : 'character';
  }

  const speakerLower = speakerName.toLowerCase();
  const personalityLower = personalityName.toLowerCase();
  const isSelf =
    speakerLower.startsWith(personalityLower) || personalityLower.startsWith(speakerLower);
  return isSelf ? 'assistant' : 'character';
}

/**
 * Resolve speaker name and role from a history entry.
 *
 * Rendered role is relative to the RESPONDING personality: `assistant` is
 * reserved for its own lines, and a sibling persona's message (same bot,
 * different character card) renders as `character`. Tagging siblings as
 * `assistant` tells the model those are its own words, which contradicts its
 * character identity and derails reasoning in multi-persona channels.
 *
 * Single source of truth for both the chat-log formatter and the length
 * estimator — the estimated shape must not drift from the rendered shape.
 *
 * @param msg - The message to resolve
 * @param personalityName - Current AI personality name (fallback for assistant messages)
 * @param allPersonalityNames - Set of all AI personality names in the conversation (for collision detection)
 * @param responderPersonalityId - The RESPONDING personality's id. When present
 *   alongside the row's own `personalityId`, it decides self-vs-sibling
 *   outright; the name comparison is the fallback for rows that carry no id.
 * @returns Speaker name and role, or null if message should be skipped
 */
export function resolveSpeakerInfo(
  msg: RawHistoryEntry,
  personalityName: string,
  allPersonalityNames?: Set<string>,
  responderPersonalityId?: string
): { speakerName: string; role: ChatLogRole; normalizedRole: string } | null {
  const normalizedRole = String(msg.role).toLowerCase();

  if (normalizedRole === 'user') {
    // User message - use persona name if available
    let speakerName =
      msg.personaName !== undefined && msg.personaName.length > 0 ? msg.personaName : 'User';

    // Disambiguate when persona name matches ANY AI personality name in the conversation
    // This handles multi-AI channels where user "Lila" could be confused with "Lila AI"
    // Format: "Lila (@lbds137)" to make it clear who is who
    const speakerLower = speakerName.toLowerCase();
    const needsDisambiguation =
      speakerLower === personalityName.toLowerCase() ||
      (allPersonalityNames !== undefined &&
        Array.from(allPersonalityNames).some(name => name.toLowerCase() === speakerLower));

    if (
      needsDisambiguation &&
      msg.discordUsername !== undefined &&
      msg.discordUsername.length > 0
    ) {
      speakerName = `${speakerName} (@${msg.discordUsername})`;
    }

    return { speakerName, role: 'user', normalizedRole };
  }

  if (normalizedRole === 'assistant') {
    // For assistant messages, use the AI personality's name from the message
    // This enables correct attribution in multi-AI channels (e.g., COLD seeing Lila AI's messages)
    // Fall back to the current personalityName for legacy data without personalityName
    const speakerName =
      msg.personalityName !== undefined && msg.personalityName.length > 0
        ? msg.personalityName
        : personalityName;
    // Sibling persona → 'character'. Legacy rows without a stored personality
    // name fall back to the current name above, so they compare equal and keep
    // rendering as 'assistant' (pre-existing attribution behavior).
    //
    // Self-match is prefix-bidirectional, not strict equality: DB-persisted rows
    // store `personality.name` (same vocabulary as the parameter), but the
    // extended-context fetch's registry-miss fallback stores the webhook
    // DISPLAY name (`${displayName}${botSuffix}`) — a strict compare would
    // demote the persona's OWN rows whenever name !== displayName. Cost: the
    // check is symmetric, so BOTH prefix directions collide. A sibling whose
    // name is a prefix of the responder's reads as self ("Alex" sibling under
    // an "Alexandra" responder), and so does the reverse — an unrelated
    // sibling "Alexandra" under an "Alex" responder reads as self by the same
    // rule. (Same accepted bounded edge as referenceRole.ts's self-variant
    // skip.)
    const role: ChatLogRole = resolveAssistantRowRole(
      msg,
      speakerName,
      personalityName,
      responderPersonalityId
    );
    return { speakerName, role, normalizedRole };
  }

  // System or unknown - skip
  return null;
}

/**
 * Check if a role matches the expected role (case-insensitive).
 * Handles legacy data that may have capitalized roles ("User", "Assistant")
 * vs the current standard lowercase roles from MessageRole enum.
 *
 * @param actual - The actual role value from data
 * @param expected - The expected role (from MessageRole enum)
 * @returns true if the roles match (case-insensitive)
 */
export function isRoleMatch(actual: string | MessageRole, expected: MessageRole): boolean {
  const normalizedActual = String(actual).toLowerCase();
  const normalizedExpected = String(expected).toLowerCase();
  return normalizedActual === normalizedExpected;
}

/**
 * Participant information extracted from conversation history
 */
interface Participant {
  personaId: string;
  personaName: string;
  isActive: boolean;
}

/**
 * Extract unique participants from conversation history
 * Returns list of all personas involved in the conversation
 */
export function extractParticipants(
  history: {
    role: MessageRole;
    content: string;
    personaId?: string;
    personaName?: string;
  }[],
  activePersonaId?: string,
  activePersonaName?: string
): Participant[] {
  const uniquePersonas = new Map<string, string>(); // personaId -> personaName

  const userMessagesWithPersona = history.filter(
    m =>
      isRoleMatch(m.role, MessageRole.User) &&
      m.personaId !== undefined &&
      m.personaId.length > 0 &&
      m.personaName !== undefined &&
      m.personaName.length > 0
  ).length;
  logger.debug(
    {
      activePersonaId: activePersonaId ?? null,
      // Persona display names are user-chosen self-identity — ids only.
      hasActivePersonaName: activePersonaName !== undefined && activePersonaName.length > 0,
      historyLength: history.length,
      userMessagesWithPersona,
    },
    'Extracting participants'
  );

  // Extract from history
  for (const msg of history) {
    if (
      isRoleMatch(msg.role, MessageRole.User) &&
      msg.personaId !== undefined &&
      msg.personaId.length > 0 &&
      msg.personaName !== undefined &&
      msg.personaName.length > 0
    ) {
      uniquePersonas.set(msg.personaId, msg.personaName);
    }
  }

  // Ensure active persona is included (even if not in history yet)
  if (
    activePersonaId !== undefined &&
    activePersonaId.length > 0 &&
    activePersonaName !== undefined &&
    activePersonaName.length > 0
  ) {
    uniquePersonas.set(activePersonaId, activePersonaName);
  }

  // Single summary log instead of per-iteration logging
  if (uniquePersonas.size > 0) {
    const participantIds = Array.from(uniquePersonas.keys());
    logger.debug({ count: uniquePersonas.size, participantIds }, 'Found participants');
  }

  // Convert to array with isActive flag
  return Array.from(uniquePersonas.entries()).map(([personaId, personaName]) => ({
    personaId,
    personaName,
    isActive: personaId === activePersonaId,
  }));
}

/**
 * A sibling AI character present in the conversation window.
 *
 * Separate from {@link Participant} because the two are different kinds of
 * entity with different id spaces — a persona UUID versus a personality UUID —
 * and the roster tells the model which is which. They share ONE id space at
 * the prompt level in the sense that matters: `from_id` resolves against every
 * id in `<participants>` under a single rule, regardless of element.
 */
export interface CharacterParticipant {
  /** The personality UUID a chat-log `from_id` on a role="character" line carries. */
  personalityId: string;
  /** The personality's unique name (not display name) — see ConversationMessageMapper. */
  personalityName: string;
}

/**
 * Collect the sibling characters whose lines appear in a history window.
 *
 * The membership test is `resolveSpeakerInfo` itself rather than a
 * reimplementation of its self-match rule, so the roster and the chat log
 * cannot disagree about who is a sibling: an entry gets a roster entry exactly
 * when its own line renders as role="character". That also delivers the
 * owner's exclusion of the CURRENTLY-SPEAKING character for free — its lines
 * resolve to role="assistant", so it is never collected.
 *
 * Rows lacking `personalityId` (the extended-context fetch's registry-miss
 * fallback writes a display name with no id) are skipped rather than
 * defaulted: a roster entry no `from_id` can point at is worse than no entry,
 * and those lines already render unattributed today.
 *
 * SELECTION is by recency, capped at MAX_ROSTER_CHARACTERS — the walk runs
 * newest-first and stops once the cap is full, so a busy multi-bot channel
 * keeps the siblings actually in play rather than whichever happened to speak
 * first. Without the cap the only bound is MAX_EXTENDED_CONTEXT (100), and the
 * roster is paid for on every turn.
 *
 * RENDERING is then sorted by personalityId, for the same reason the persona
 * roster is — this block sits in the provider's prompt-cache prefix, and
 * recency order reshuffles between turns for no informational gain. Selection
 * by recency, ordering by id: the same split the persona roster makes.
 *
 * A capped-out sibling loses its roster entry, so its lines render with a
 * `from_id` that resolves to nothing. That is the same degradation an id-less
 * row already gets, and it is preferred over an unbounded per-turn cost.
 */
export function extractCharacterParticipants(
  history: RawHistoryEntry[] | undefined,
  personalityName: string,
  responderPersonalityId?: string
): CharacterParticipant[] {
  if (history === undefined || history.length === 0) {
    return [];
  }

  const byId = new Map<string, string>();
  // Newest-first: history arrives chronologically, and the cap must keep the
  // most recently active siblings rather than the first ones seen.
  for (let i = history.length - 1; i >= 0; i--) {
    if (byId.size >= MESSAGE_LIMITS.MAX_ROSTER_CHARACTERS) {
      break;
    }
    const msg = history[i];
    const speakerInfo = resolveSpeakerInfo(msg, personalityName, undefined, responderPersonalityId);
    if (speakerInfo?.role !== 'character') {
      continue;
    }
    const id = msg.personalityId;
    if (id === undefined || id.length === 0) {
      continue;
    }
    // FIRST-SEEN WINS, and the guard is load-bearing rather than an
    // optimization. The walk is newest-first, so an unconditional `set` would
    // let each older occurrence overwrite the name — leaving the roster showing
    // a renamed sibling's OLDEST name, the exact opposite of the recency this
    // function selects by. Keyed on the stable personalityId, so `from_id`
    // binding is unaffected either way; only the displayed name moves.
    if (byId.has(id)) {
      continue;
    }
    // resolveSpeakerInfo already resolved the display fallback; storing its
    // answer keeps the roster name and the chat-log `from=` byte-identical.
    byId.set(id, speakerInfo.speakerName);
  }

  return [...byId.entries()]
    .map(([personalityId, characterName]) => ({
      personalityId,
      personalityName: characterName,
    }))
    .sort((a, b) =>
      a.personalityId < b.personalityId ? -1 : a.personalityId > b.personalityId ? 1 : 0
    );
}
