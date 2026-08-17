/**
 * Participant Formatter
 *
 * Formats conversation participant personas for the system message, ahead of
 * the chat log whose from_id attributes bind to this roster.
 * Uses pure XML structure with ID binding for clear identity association.
 *
 * Key features:
 * - <participant id="..."> tags with unique personaId for ID binding
 * - Structured fields: <name>, <pronouns> as separate XML elements
 * - escapeXmlContent on the <about> body (targeted escaping: renders structural
 *   tags inert to the LLM while preserving literal <3 / x > 5)
 * - source="user_input" attribution to clarify first-person content origin
 * - Optional guild info (roles, color, join date) for Discord server context
 *
 * Every byte this module emits is derived from the roster alone — never from
 * who is speaking this turn. The block sits in the provider's prompt-cache
 * prefix (S1), so a per-speaker bit here invalidates the roster AND the whole
 * chat_log that follows it on every speaker change in a multi-human channel.
 * The current speaker is identified by the `<from>` tag on the turn itself,
 * which lives in the volatile tier where per-request bytes belong.
 *
 * Extracted from PromptBuilder for better modularity.
 */

import { formatDateOnly } from '@tzurot/common-types/utils/dateFormatting';
import { escapeXml } from '@tzurot/common-types/utils/xmlBuilder';
import { escapeXmlContent } from '@tzurot/common-types/utils/promptSanitizer';
import type { ParticipantInfo } from '../ConversationalRAGTypes.js';

/** The display name rendered for a participant — also what collides. */
function participantDisplayName(info: ParticipantInfo): string {
  return info.preferredName ?? info.personaName;
}

/**
 * Does any roster member render under the character's own name?
 *
 * Roster-derived rather than speaker-derived: a colliding participant is a
 * standing fact about the conversation, not a property of whoever happens to
 * be talking, so the answer (and therefore the note it drives) is stable
 * across turns.
 */
function rosterCollidesWithCharacter(
  participants: ParticipantInfo[],
  personalityName: string
): boolean {
  if (personalityName.length === 0) {
    return false;
  }
  const target = personalityName.toLowerCase();
  return participants.some(info => participantDisplayName(info).toLowerCase() === target);
}

/** The trailing `<note>` lines: collision disambiguation + group-conversation hint. */
function buildRosterNotes(participants: ParticipantInfo[], personalityName: string): string[] {
  const notes: string[] = [];

  // Name-collision disambiguation. Deliberately names nobody: the concrete
  // "Name (@username)" form is rendered by the <from> tag on the current turn
  // (buildDisambiguatedDisplayName), which is volatile-tier already. Naming the
  // colliding user here would put a speaker-derived string in the cached prefix.
  // Phrased without number so it reads correctly whether one roster member
  // collides or several do.
  if (rosterCollidesWithCharacter(participants, personalityName)) {
    notes.push(
      '<note>A name in the roster above matches your own. Names are not unique here — bind identity by from_id, never by name. Anyone appearing under your name is a different person from you.</note>'
    );
  }

  if (participants.length > 1) {
    notes.push(
      '<note>This is a group conversation. Each chat_log message carries a from_id identifying its speaker — match it to the participant ids above.</note>'
    );
  }

  return notes;
}

/**
 * Render one `<participant>` element as its constituent lines.
 *
 * Shared with the frozen legacy eval arm, which reproduces pre-restructure
 * bytes: the element body never changed, only the ordering, the `active`
 * attribute, and the trailing notes — so those are the caller's business and
 * this stays the single source for the body.
 *
 * @param markActive - emit `active="true"` for the current speaker. Production
 *   never does (it made the cached prefix per-speaker); the legacy arm must.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Conditional pronouns, guild attributes, and roles each branch independently
export function renderParticipantElement(info: ParticipantInfo, markActive = false): string[] {
  const parts: string[] = [];

  const activeAttr = markActive && info.isActive ? ' active="true"' : '';
  parts.push(`<participant id="${escapeXml(info.personaId)}"${activeAttr}>`);

  // Name element - use preferredName if available, otherwise fall back to personaName
  parts.push(`<name>${escapeXml(participantDisplayName(info))}</name>`);

  // Pronouns element (if available)
  if (info.pronouns !== undefined && info.pronouns.length > 0) {
    parts.push(`<pronouns>${escapeXml(info.pronouns)}</pronouns>`);
  }

  // Guild info (if available) - attributes for metadata, child element for roles
  if (info.guildInfo) {
    const guildAttrs: string[] = [];

    if (info.guildInfo.displayColor !== undefined && info.guildInfo.displayColor !== '') {
      guildAttrs.push(`color="${escapeXml(info.guildInfo.displayColor)}"`);
    }

    if (info.guildInfo.joinedAt !== undefined && info.guildInfo.joinedAt !== '') {
      const dateOnly = formatDateOnly(info.guildInfo.joinedAt, 'UTC');
      guildAttrs.push(`joined="${escapeXml(dateOnly)}"`);
    }

    const hasRoles = info.guildInfo.roles.length > 0;
    const attrsStr = guildAttrs.length > 0 ? ` ${guildAttrs.join(' ')}` : '';

    if (hasRoles) {
      // Roles as child elements
      parts.push(`<guild_info${attrsStr}>`);
      parts.push('<roles>');
      for (const role of info.guildInfo.roles) {
        parts.push(`<role>${escapeXml(role)}</role>`);
      }
      parts.push('</roles>');
      parts.push('</guild_info>');
    } else if (guildAttrs.length > 0) {
      // Self-closing if only attributes, no roles
      parts.push(`<guild_info${attrsStr}/>`);
    }
  }

  // User-provided persona content. Uses escapeXmlContent (targeted): it
  // preserves literal <3 / x > 5 like CDATA did, but ALSO renders any
  // structural tag inert to the LLM (CDATA does not — the model reads raw
  // text, so a CDATA-wrapped </about> is still visible markup to it). <about>
  // and <participant> are protected so content can't forge another party.
  // source="user_input" tells LLM this is user's self-description, not system instructions
  parts.push(`<about source="user_input">${escapeXmlContent(info.content)}</about>`);

  parts.push('</participant>');

  return parts;
}

/** The opening lines every roster block shares — shared with the legacy arm. */
export const PARTICIPANTS_INSTRUCTION =
  '<instruction>These people are in this conversation. Match from_id attribute in chat_log messages to participant id attribute.</instruction>';

/**
 * Format conversation participants with their personas
 *
 * Output format:
 * ```xml
 * <participants>
 *   <instruction>These people are in this conversation. Match from_id in chat_log to participant IDs.</instruction>
 *   <participant id="persona-uuid-123">
 *     <name>Lila</name>
 *     <pronouns>she/her, they/them</pronouns>
 *     <guild_info color="#FF00FF" joined="2023-05-15">
 *       <roles>
 *         <role>Admin</role>
 *         <role>Developer</role>
 *       </roles>
 *     </guild_info>
 *     <about source="user_input">A transgender demon-angel in human form...</about>
 *   </participant>
 * </participants>
 * ```
 *
 * @param participantPersonas - Map of resolvedPersonaId (UUID) to ParticipantInfo
 * @param personalityName - The character's own name; drives the name-collision
 *   note when a roster member renders under the same name
 * @returns Formatted participants context string in XML, or empty string if no participants
 */
export function formatParticipantsContext(
  participantPersonas: Map<string, ParticipantInfo>,
  personalityName: string
): string {
  if (participantPersonas.size === 0) {
    return '';
  }

  const parts: string[] = [];
  parts.push('<participants>');
  parts.push(PARTICIPANTS_INSTRUCTION);

  // Render in persona-UUID order, not Map-iteration (recency) order. Selection
  // upstream stays recency-based — the MAX_EXTENDED_CONTEXT_PARTICIPANTS cap
  // keeps the most recently active — but this block sits in the provider's
  // prompt-cache prefix, and prod measurement showed recency-ordered rendering
  // reshuffles it between turns, invalidating the cached prefix for no
  // informational gain. The UUID is a stable deterministic key over the same
  // selected set.
  // Ordinal compare, NOT localeCompare: the sort exists for byte-determinism,
  // and an unpinned localeCompare is ICU-driven — a Node/ICU bump between
  // deploys could reorder the same set and silently cost a full prefix miss.
  const orderedParticipants = [...participantPersonas.values()].sort((a, b) =>
    a.personaId < b.personaId ? -1 : a.personaId > b.personaId ? 1 : 0
  );

  for (const info of orderedParticipants) {
    // No `active` attribute: the speaker is identified by the turn's own <from>
    // tag, and marking them here made the cached prefix per-speaker.
    parts.push(...renderParticipantElement(info));
  }

  parts.push(...buildRosterNotes(orderedParticipants, personalityName));

  parts.push('</participants>');

  // Bare block — the section assembler owns inter-section separators.
  return parts.join('\n');
}
