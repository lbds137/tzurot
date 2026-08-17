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
 * - an "In <name>'s own words:" lead-in ON the <about> body, so a first-person
 *   bio is bound to its author in the prose and not only by tag nesting
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

/**
 * The display name rendered for a participant — also what collides.
 *
 * Blank-or-absent both fall back to `personaName`. `??` alone would let an
 * empty `preferredName` through: harmless while it only produced an empty
 * `<name>` element, but this string is now also spliced into a natural-language
 * sentence, where it reads as `In 's own words:`. The known producer is
 * `displayName ?? username` (identity's UserService), so an empty value is not
 * reachable from there — the guard is here because proving no OTHER writer can
 * ever store `''` is a repo-wide negative, and this costs one predicate.
 */
function participantDisplayName(info: ParticipantInfo): string {
  const preferred = info.preferredName;
  return preferred !== undefined && preferred.trim().length > 0 ? preferred : info.personaName;
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
 * The lead-in that binds a bio to its author in the prose itself.
 *
 * The enclosing `<participant>` element already says whose bio this is, but
 * that nesting is precisely what failed: a ~2,000-char first-person bio
 * belonging to a NON-speaking participant was read as the current speaker's
 * own words, and the character then answered a third party's messages as
 * though that speaker had sent them. Identity bleed, not merely token cost.
 * A model does not reliably carry an XML ancestor across two thousand
 * characters of "I" statements, so the binding is restated in the text the
 * model is actually reading.
 *
 * Deliberately NOT an attribute (`<about speaker="...">`): an attribute is the
 * same structural mechanism that already failed here, and it would sit two
 * lines from the `<name>` element that carries the identical fact. It costs
 * bytes without contributing a different KIND of signal.
 *
 * The name is the participant's own, so this adds no speaker-derived byte to
 * the S1 cache prefix — pinned by the speaker-independence tests in
 * `ParticipantFormatter.test.ts`. Escaped with `escapeXml` (strict) rather
 * than the body's targeted `escapeXmlContent`, matching how `<name>` renders
 * the same string.
 */
function aboutLeadIn(displayName: string): string {
  return `In ${escapeXml(displayName)}'s own words: `;
}

/** Per-call render switches; both defaults are what production wants. */
export interface RenderParticipantOptions {
  /**
   * Emit `active="true"` for the current speaker. Production never does (it
   * made the cached prefix per-speaker); the frozen legacy eval arm must.
   */
  markActive?: boolean;
  /**
   * Prefix the `<about>` body with {@link aboutLeadIn}. The frozen legacy eval
   * arm opts out: its whole purpose is reproducing the bytes that shipped
   * before this attribution existed.
   */
  attributeAbout?: boolean;
}

/**
 * Render one `<participant>` element as its constituent lines.
 *
 * Shared with the frozen legacy eval arm, which reproduces pre-restructure
 * bytes: the ordering, the `active` attribute, and the trailing notes are the
 * caller's business, and this stays the single source for the body. The body
 * is no longer identical across the two arms — hence `attributeAbout`, which
 * is the only body-level difference.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Conditional pronouns, guild attributes, and roles each branch independently
export function renderParticipantElement(
  info: ParticipantInfo,
  options: RenderParticipantOptions = {}
): string[] {
  const { markActive = false, attributeAbout = true } = options;
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
  //
  // An empty bio is a supported state, not a defect: MemoryRetriever warns and
  // keeps the participant on identity fields alone, because dropping bio-less
  // users removed them from the roster entirely while chat_log from_id still
  // pointed at them. A lead-in with nothing behind it would assert an
  // authorship no text follows, so an empty bio renders bare.
  // `hasBio` tests the TRIMMED content, so the lead-in must consume the same
  // leading whitespace it tested — the lead-in already ends in a space, and
  // concatenating raw content behind it renders " Hi" as a double space. Only
  // the LEADING side is trimmed: trailing whitespace sits at the end of the
  // element where it costs nothing and is not the author's to lose.
  const hasBio = info.content.trim().length > 0;
  const aboutBody =
    attributeAbout && hasBio
      ? `${aboutLeadIn(participantDisplayName(info))}${escapeXmlContent(info.content.trimStart())}`
      : escapeXmlContent(info.content);
  parts.push(`<about source="user_input">${aboutBody}</about>`);

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
 *     <about source="user_input">In Lila's own words: I am a transgender demon-angel in human form...</about>
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
