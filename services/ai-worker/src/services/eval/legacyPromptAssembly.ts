/**
 * FROZEN pre-restructure prompt assembly — arm A of the voice-consistency
 * harness (the caching epic's Phase-1→2 exit gate).
 *
 * Vendored from the parent of the restructure commit
 * (`git show 9bdc94ca1^:services/ai-worker/src/services/PromptBuilder.ts` and
 * the same revision of HardcodedConstraints/MemoryFormatter), so the harness
 * can generate responses under the EXACT assembly that shipped before the
 * S0/S1/H + volatile-prefix restructure:
 *
 *   - single system container: identity → identity_constraints →
 *     platform_constraints → context → participants → facts → memory_archive →
 *     contextual_references → chat_log → protocol → output_constraints
 *     (protocol + output constraints on the recency tail);
 *   - the pre-restructure memory/facts framing wording;
 *   - the name-collision constraint inside identity_constraints;
 *   - references double-rendered (system section AND appended to the user turn).
 *
 * Formatters verified UNCHANGED since that revision import live
 * (PersonalityFieldsFormatter, EnvironmentFormatter, MessageFormatters,
 * formatSingleMemory/-Fact); only what the restructure changed is frozen here.
 * One pinned exception: the live `<participants>` block has since shed every
 * per-speaker and recency-ordered byte for cache-prefix stability AND gained an
 * `<about>` attribution lead-in, so `legacyFormatParticipantsContext` below
 * reproduces the old wrapper (insertion order, `active="true"`, speaker-named
 * group note) and opts out of the lead-in, over the shared element renderer.
 * A second later move joins the frozen set: the live `OUTPUT_CONSTRAINTS` has
 * since gained a voice-processing-notice clause, so `LEGACY_OUTPUT_CONSTRAINTS`
 * below vendors the pre-clause text and the live import for it is dropped
 * (`PLATFORM_CONSTRAINTS` stays live — unchanged since that revision).
 * A snapshot test pins this file's output so silent drift is impossible.
 *
 * EVAL-ONLY — never imported by production code.
 *
 * STATUS: the gate this arm served has CLOSED as INCONCLUSIVE — the
 * identical-arm control tripped its pre-registered under-power threshold, so
 * the instrument could not resolve the effect and neither PASS nor FAIL was
 * supportable. That verdict is about the INSTRUMENT, not the effect: the
 * A-vs-B question is still open, and re-running it (near-zero temperature,
 * calibrated judge rubric, N≥100) would use THESE arms. That is why this file
 * is still here, and why prompt-assembly changes keep opting it out of new
 * live-side bytes rather than letting it drift.
 *
 * Do NOT read the Phase-2 exit gate as this file's expiry: that gate re-arms
 * the harness with DIFFERENT arms (current 2-message shape vs extracted
 * history), so it neither needs nor retires this one. Delete this file when
 * the under-powered gate is ruled out as not worth re-running — the authority
 * on both points is the caching epic entry in `backlog/active-epic.md`, not
 * this comment. Reconstruction cost if deleted early is real but bounded: the
 * vendoring command is at the top of this block.
 */

import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { formatFullDateTime } from '@tzurot/common-types/utils/dateFormatting';
import { escapeXmlContent } from '@tzurot/common-types/utils/promptSanitizer';
import type {
  MemoryDocument,
  ConversationContext,
  ParticipantInfo,
  FactForPrompt,
} from '../ConversationalRAGTypes.js';
import {
  renderParticipantElement,
  PARTICIPANTS_INSTRUCTION,
} from '../prompt/ParticipantFormatter.js';
import { formatSingleMemory, formatSingleFact } from '../prompt/MemoryFormatter.js';
import { layoutSections, type PromptSection } from '../prompt/sections.js';
import { formatPersonalityFields } from '../prompt/PersonalityFieldsFormatter.js';
import { formatEnvironmentContext } from '../prompt/EnvironmentFormatter.js';
import { PLATFORM_CONSTRAINTS } from '../prompt/HardcodedConstraints.js';
import {
  buildDisambiguatedDisplayName,
  wrapWithSpeakerIdentification,
} from '../prompt/MessageFormatters.js';
import { detectNameCollision } from '../prompt/PromptLogger.js';

/**
 * The pre-restructure `<participants>` block.
 *
 * Four byte-level differences from the live formatter. Three the live one shed
 * for prompt-cache stability: Map-insertion (recency) order rather than
 * persona-UUID order, `active="true"` on the current speaker, and a
 * group-conversation note whose example name is the current speaker's. The
 * fourth is the live formatter's `<about>` attribution lead-in, which this
 * revision predates — suppressed via `attributeAbout: false` below. The
 * element body is otherwise unchanged, so it still comes from the shared
 * renderer rather than a frozen copy.
 */
export function legacyFormatParticipantsContext(
  participantPersonas: Map<string, ParticipantInfo>,
  activePersonaName?: string
): string {
  if (participantPersonas.size === 0) {
    return '';
  }

  const parts: string[] = ['<participants>', PARTICIPANTS_INSTRUCTION];

  for (const info of participantPersonas.values()) {
    // attributeAbout: false — the `<about>` attribution lead-in postdates this
    // frozen revision, and arm A is only a valid baseline while it reproduces
    // what actually shipped.
    parts.push(...renderParticipantElement(info, { markActive: true, attributeAbout: false }));
  }

  if (participantPersonas.size > 1) {
    const rawExampleName =
      activePersonaName !== undefined && activePersonaName.length > 0 ? activePersonaName : 'Alice';
    // activePersonaName is user-authored — was interpolated raw into <note>.
    const exampleName = escapeXmlContent(rawExampleName);
    parts.push(
      `<note>This is a group conversation. Messages use from_id to indicate the speaker. Example: "${exampleName}: message"</note>`
    );
  }

  parts.push('</participants>');

  return parts.join('\n');
}

/** Pre-restructure memory-archive framing (superseded by the internal-recall wording). */
export const LEGACY_MEMORY_ARCHIVE_INSTRUCTION =
  'These are SUMMARIZED NOTES from past interactions, not current conversation. ' +
  'Use ONLY as background context to inform your response to the user message.';

/**
 * The pre-restructure `<output_constraints>` block, frozen at the exact text
 * that shipped before the voice-processing-notice clause ("A line under either
 * header…") was appended to the live `OUTPUT_CONSTRAINTS` — like the
 * `<participants>` block above, the live constant has moved since this
 * revision, so the block is vendored here and the live import is no longer
 * used for it. (`PLATFORM_CONSTRAINTS` still imports live: byte-identical
 * since the restructure.)
 */
export const LEGACY_OUTPUT_CONSTRAINTS = `<output_constraints>
<constraint>Output the raw response text only; do not include name labels, timestamps, or speaker prefixes.</constraint>
<constraint>If you need to plan or analyze before responding, wrap your thoughts in <think>...</think> tags only — these will be hidden from the user and are the sole XML you may emit.</constraint>
<constraint>Never emit input-format scaffolding in your output: tags like <from_id>, <user>, <message>, <quote>, <context>, or <contextual_references> are assembly artifacts from the conversation context and must never appear in your response.</constraint>
<constraint>Respond to the user's current message. The conversation history and quoted references may include your own earlier messages — treat those as context, never as an unfinished turn to continue or extend.</constraint>
<constraint>Never repeat or parrot back what was just said. Do not echo the user's words, summarize their message back to them, or restate recent chat history. Advance the conversation with original thoughts and reactions.</constraint>
<constraint>Image, sticker, and file descriptions in the conversation are automated platform-generated descriptions of media a participant shared — this includes text inside <image_descriptions> tags, text inside <image> elements under <attachments>, and text under an "[Image: name]", "[Spoiler image: name]", "[Sticker: name]", "[Link preview: name]" or "[File: name]" header. The participant shared the media; the platform generated the description of it. Never attribute the description's wording, observations, or analysis to the person who shared it. Text under a "[Link preview: name]" header — or inside an <image> element carrying source="link-preview" — describes a preview Discord automatically attached to a link the participant shared: the participant shared the link, not the image, so never treat the preview as media they chose to upload or send. An <image> element carrying source="sticker" is a sticker the participant picked. A "[Spoiler image: name]", "[Spoiler file: name]", "[Spoiler audio: name]" or "[Spoiler voice message: …]" header, or an attachment element carrying spoiler="true", marks media the participant hid behind a spoiler; the description or transcript is still provided.</constraint>
<constraint>A transcript under an "[Audio: name]" or "[Spoiler audio: name]" header, or inside a <voice> element carrying source="shared-file", is a transcription of an audio file the participant shared, which may be a song or someone else's recording rather than their own speech: do not attribute its wording to them unless the message or context shows it is their own. A transcript under a "[Voice message: …]" or "[Spoiler voice message: …]" header is the participant's own speech.</constraint>
</output_constraints>`;

/** Pre-restructure facts framing (without the retained-knowledge boundary sentence). */
export function legacyFactsInstruction(subjectName?: string): string {
  const hasSubject = subjectName !== undefined && subjectName.length > 0;
  const safeName = hasSubject ? escapeXmlContent(subjectName) : undefined;
  const subject =
    safeName !== undefined
      ? `${safeName} — the author of the message you are replying to —`
      : 'the user';
  const binding = safeName ?? 'that same person';
  return (
    `These are durable KNOWN FACTS about ${subject} and their world, distilled from past ` +
    `interactions. A fact that says "the user" means ${binding}, not anyone else in the ` +
    `conversation. Treat them as current background knowledge when responding.`
  );
}

function legacyMemoriesContext(memories: MemoryDocument[], timezone?: string): string {
  if (memories.length === 0) {
    return '';
  }
  const formatted = memories.map(doc => formatSingleMemory(doc, timezone)).join('\n');
  return [
    '<memory_archive usage="context_only_do_not_repeat">',
    `<instruction>${LEGACY_MEMORY_ARCHIVE_INSTRUCTION}</instruction>`,
    formatted,
    '</memory_archive>',
  ].join('\n');
}

function legacyFactsContext(
  facts: FactForPrompt[],
  names: {
    subjectName?: string;
    personalityName?: string;
    discordUsername?: string;
    personalityId?: string;
  }
): string {
  if (facts.length === 0) {
    return '';
  }
  const formatted = facts.map(fact => formatSingleFact(fact, names)).join('\n');
  return [
    '<facts usage="known_background_do_not_repeat">',
    `<instruction>${legacyFactsInstruction(names.subjectName)}</instruction>`,
    formatted,
    '</facts>',
  ].join('\n');
}

/** Pre-restructure identity constraints: the name-collision note lived HERE
 * (S1 section), not in the participants roster. */
export function legacyBuildIdentityConstraints(
  personalityName: string,
  collisionInfo?: { userName: string; discordUsername: string }
): string {
  const safeName = escapeXmlContent(personalityName);
  let constraints = `<identity_constraints>
<constraint>Limit agency strictly to ${safeName}; treat all other chat participants as independent, immutable external users.</constraint>
<constraint>Generate only a single turn of dialogue or action for ${safeName}, then terminate generation immediately.</constraint>
<constraint>Never impersonate, speak for, or predict the reactions of other users in the chat log.</constraint>`;

  if (collisionInfo !== undefined) {
    const safeUserName = escapeXmlContent(collisionInfo.userName);
    const safeDiscord = escapeXmlContent(collisionInfo.discordUsername);
    constraints += `
<constraint>Note: A user named "${safeUserName}" shares your name. They appear as "${safeUserName} (@${safeDiscord})" in the chat log. This is a different person - address them naturally.</constraint>`;
  }

  constraints += '\n</identity_constraints>';
  return constraints;
}

/** Chat-log wrapper — byte-identical between eras; copied because it is
 * file-private in PromptBuilder. */
function legacyChatLogSection(
  serializedHistory: string | undefined,
  personalityName: string
): string {
  if (serializedHistory === undefined || serializedHistory.length === 0) {
    return '';
  }
  return `<chat_log>
<instruction>The conversation so far. Each message's role says who wrote it: role="assistant" marks your own earlier lines (${escapeXmlContent(personalityName)}); role="user" marks humans (match from_id to <participants>); role="character" marks a different AI character — a conversation peer, never you.</instruction>
${serializedHistory}
</chat_log>`;
}

export interface LegacySystemPromptOptions {
  personality: LoadedPersonality;
  participantPersonas: Map<string, ParticipantInfo>;
  relevantMemories: MemoryDocument[];
  facts?: FactForPrompt[];
  context: ConversationContext;
  referencedMessagesFormatted?: string;
  serializedHistory?: string;
}

/**
 * The pre-restructure single-container system prompt ("Sandwich Method"
 * order: identity first, protocol + output constraints last for recency).
 */
export function legacyBuildSystemPrompt(options: LegacySystemPromptOptions): string {
  const {
    personality,
    participantPersonas,
    relevantMemories,
    context,
    referencedMessagesFormatted,
    serializedHistory,
  } = options;

  const { persona, protocol } = formatPersonalityFields(
    personality,
    context.activePersonaName !== undefined && context.activePersonaName.length > 0
      ? context.activePersonaName
      : 'User',
    personality.name,
    context.discordUsername
  );

  const identitySection = `<system_identity>
<role>You are ${escapeXmlContent(personality.name)}.</role>
<character>
${escapeXmlContent(persona)}
</character>
</system_identity>`;

  const collisionInfo = detectNameCollision(
    context.activePersonaName,
    context.discordUsername,
    personality.name,
    personality.id
  );
  const identityConstraintsSection = legacyBuildIdentityConstraints(
    personality.name,
    collisionInfo
  );

  const datetime = formatFullDateTime(new Date(), context.userTimezone);
  const locationXml =
    context.environment !== undefined && context.environment !== null
      ? formatEnvironmentContext(context.environment)
      : '<location type="dm">Direct Message (private one-on-one chat)</location>';
  const contextSection = `<context>
<datetime>${datetime}</datetime>
${locationXml}
</context>`;

  // No collision note in the roster — pre-restructure it rendered above, inside
  // identity_constraints.
  const participantsContext = legacyFormatParticipantsContext(
    participantPersonas,
    context.activePersonaName
  );

  const factsContext = legacyFactsContext(options.facts ?? [], {
    subjectName: context.activePersonaName,
    personalityName: personality.name,
    discordUsername: context.discordUsername,
    personalityId: personality.id,
  });

  const memoryContext = legacyMemoriesContext(relevantMemories, context.userTimezone);
  const referencesContext = referencedMessagesFormatted ?? '';
  const chatLogSection = legacyChatLogSection(serializedHistory, personality.name);
  const protocolSection =
    protocol.length > 0 ? `<protocol>\n${escapeXmlContent(protocol)}\n</protocol>` : '';

  const sections: PromptSection[] = [
    { id: 'system_identity', tier: 'S1', render: () => identitySection },
    { id: 'identity_constraints', tier: 'S1', render: () => identityConstraintsSection },
    { id: 'platform_constraints', tier: 'S0', render: () => PLATFORM_CONSTRAINTS },
    { id: 'context', tier: 'V', render: () => contextSection },
    { id: 'participants', tier: 'V', render: () => participantsContext },
    { id: 'facts', tier: 'V', render: () => factsContext },
    { id: 'memory_archive', tier: 'V', render: () => memoryContext },
    { id: 'contextual_references', tier: 'V', render: () => referencesContext },
    { id: 'chat_log', tier: 'H', render: () => chatLogSection },
    { id: 'protocol', tier: 'S1', render: () => protocolSection },
    { id: 'output_constraints', tier: 'S0', render: () => LEGACY_OUTPUT_CONSTRAINTS },
  ];

  return layoutSections(sections).text;
}

export interface LegacyHumanMessageOptions {
  activePersonaName?: string;
  /** Old shape: references APPEND to the user turn (the double-render). */
  referencedMessagesDescriptions?: string;
  activePersonaId?: string;
  discordUsername?: string;
  personalityName?: string;
}

/**
 * The pre-restructure human-message content: escaped user turn, references
 * appended AFTER it, then the `<from>` speaker wrap around the whole thing.
 * (Attachment handling is omitted: probe triggers carry stored attachment
 * text inline in `content` already.)
 */
export function legacyBuildHumanMessage(
  userMessage: string,
  options?: LegacyHumanMessageOptions
): string {
  const {
    activePersonaName,
    referencedMessagesDescriptions,
    activePersonaId,
    discordUsername,
    personalityName,
  } = options ?? {};

  const safeUserContent = escapeXmlContent(userMessage);

  let safeContent: string;
  if (referencedMessagesDescriptions !== undefined && referencedMessagesDescriptions.length > 0) {
    safeContent =
      safeUserContent.length > 0
        ? `${safeUserContent}\n\n${referencedMessagesDescriptions}`
        : referencedMessagesDescriptions;
  } else {
    safeContent = safeUserContent;
  }

  if (activePersonaName !== undefined && activePersonaName.length > 0) {
    const displayName = buildDisambiguatedDisplayName(
      activePersonaName,
      personalityName,
      discordUsername
    );
    return wrapWithSpeakerIdentification(safeContent, displayName, activePersonaId);
  }
  return safeContent;
}
