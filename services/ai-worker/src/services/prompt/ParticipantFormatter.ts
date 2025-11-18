/**
 * Participant Formatter
 *
 * Formats conversation participant personas for inclusion in system prompts.
 * Extracted from PromptBuilder for better modularity.
 */

/**
 * Format conversation participants with their personas
 *
 * @param participantPersonas - Map of participant names to their persona content
 * @param activePersonaName - Name of the currently active speaker (for group conversation note)
 * @returns Formatted participants context string, or empty string if no participants
 */
export function formatParticipantsContext(
  participantPersonas: Map<string, { content: string; isActive: boolean }>,
  activePersonaName?: string
): string {
  if (participantPersonas.size === 0) {
    return '';
  }

  const participantsList: string[] = [];

  for (const [personaName, { content }] of participantPersonas.entries()) {
    // No "current speaker" marker here - we'll clarify that right before the current message
    participantsList.push(`### ${personaName}\n${content}`);
  }

  const pluralNote =
    participantPersonas.size > 1
      ? `\n\nNote: This is a group conversation. Messages are prefixed with persona names (e.g., "${activePersonaName !== undefined && activePersonaName.length > 0 ? activePersonaName : 'Alice'}: message") to show who said what.`
      : '';

  return `\n\n## Conversation Participants\nThe following ${participantPersonas.size === 1 ? 'person is' : 'people are'} involved in this conversation:\n\n${participantsList.join('\n\n')}${pluralNote}`;
}
