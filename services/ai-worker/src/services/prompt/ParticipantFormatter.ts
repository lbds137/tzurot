/**
 * Participant Formatter
 *
 * Formats conversation participant personas for inclusion in system prompts.
 * Uses pure XML structure with ID binding for clear identity association.
 *
 * Key features:
 * - <participant id="..."> tags with unique personaId for ID binding
 * - Structured fields: <name>, <pronouns> as separate XML elements
 * - CDATA wrapping for user-generated content (prevents XML injection)
 * - source="user_input" attribution to clarify first-person content origin
 * - Optional guild info (roles, color, join date) for Discord server context
 *
 * Extracted from PromptBuilder for better modularity.
 */

import { escapeXml } from '@tzurot/common-types';
import type { ParticipantInfo } from '../ConversationalRAGService.js';

/**
 * Format conversation participants with their personas
 *
 * Output format:
 * ```xml
 * <participants>
 *   <instruction>These people are in this conversation. Match from_id in chat_log to participant IDs.</instruction>
 *   <participant id="persona-uuid-123" active="true">
 *     <name>Lila</name>
 *     <pronouns>she/her, they/them</pronouns>
 *     <guild_info color="#FF00FF" joined="2023-05-15">
 *       <roles>
 *         <role>Admin</role>
 *         <role>Developer</role>
 *       </roles>
 *     </guild_info>
 *     <about source="user_input"><![CDATA[A transgender demon-angel in human form...]]></about>
 *   </participant>
 * </participants>
 * ```
 *
 * @param participantPersonas - Map of participant names to their ParticipantInfo
 * @param activePersonaName - Name of the currently active speaker (for group conversation note)
 * @returns Formatted participants context string in XML, or empty string if no participants
 */
export function formatParticipantsContext(
  participantPersonas: Map<string, ParticipantInfo>,
  activePersonaName?: string
): string {
  if (participantPersonas.size === 0) {
    return '';
  }

  const parts: string[] = [];
  parts.push('<participants>');
  parts.push(
    '<instruction>These people are in this conversation. Match from_id attribute in chat_log messages to participant id attribute.</instruction>'
  );

  for (const [personaName, info] of participantPersonas.entries()) {
    // Build participant tag with id and optional active attribute
    const activeAttr = info.isActive ? ' active="true"' : '';
    parts.push(`<participant id="${escapeXml(info.personaId)}"${activeAttr}>`);

    // Name element - use preferredName if available, otherwise fall back to personaName (map key)
    const displayName = info.preferredName ?? personaName;
    parts.push(`<name>${escapeXml(displayName)}</name>`);

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
        // Format as date only (YYYY-MM-DD)
        const dateOnly = info.guildInfo.joinedAt.split('T')[0];
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

    // User-provided persona content in CDATA with source attribution
    // CDATA prevents XML injection from user content
    // source="user_input" tells LLM this is user's self-description, not system instructions
    parts.push(`<about source="user_input"><![CDATA[${info.content}]]></about>`);

    parts.push('</participant>');
  }

  // Group conversation note
  if (participantPersonas.size > 1) {
    const exampleName =
      activePersonaName !== undefined && activePersonaName.length > 0 ? activePersonaName : 'Alice';
    parts.push(
      `<note>This is a group conversation. Messages use from_id to indicate the speaker. Example: "${exampleName}: message"</note>`
    );
  }

  parts.push('</participants>');

  // Return with leading newlines for proper prompt spacing
  return '\n\n' + parts.join('\n');
}
