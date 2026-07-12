/**
 * Participant Utilities
 *
 * Helper functions for extracting and processing conversation participants.
 * Extracted from conversationUtils.ts for better modularity.
 */

import { MessageRole } from '@tzurot/common-types/constants/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { RawHistoryEntry } from './conversationTypes.js';

const logger = createLogger('participantUtils');

/** The role vocabulary rendered into `<message role="...">` chat-log attributes. */
export type ChatLogRole = 'user' | 'assistant' | 'character';

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
 * @returns Speaker name and role, or null if message should be skipped
 */
export function resolveSpeakerInfo(
  msg: RawHistoryEntry,
  personalityName: string,
  allPersonalityNames?: Set<string>
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
    // demote the persona's OWN rows whenever name !== displayName. Cost: a
    // sibling whose name is an exact prefix of the responder's reads as self
    // (same accepted bounded edge as referenceRole.ts's self-variant skip).
    const speakerLower = speakerName.toLowerCase();
    const personalityLower = personalityName.toLowerCase();
    const isSelf =
      speakerLower.startsWith(personalityLower) || personalityLower.startsWith(speakerLower);
    const role: ChatLogRole = isSelf ? 'assistant' : 'character';
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
      activePersonaName: activePersonaName ?? null,
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
    const participantNames = Array.from(uniquePersonas.values()).join(', ');
    logger.debug({ count: uniquePersonas.size, participantNames }, 'Found participants');
  }

  // Convert to array with isActive flag
  return Array.from(uniquePersonas.entries()).map(([personaId, personaName]) => ({
    personaId,
    personaName,
    isActive: personaId === activePersonaId,
  }));
}
