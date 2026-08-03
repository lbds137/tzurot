/**
 * Voice-consistency harness arms — competing prompt assemblies over ONE frozen
 * probe input bundle (the paired-design guarantee: only arrangement differs).
 *
 *   A  — frozen pre-restructure assembly (legacyPromptAssembly.ts)
 *   B  — current production PromptBuilder (S0/S1/H system + volatile prefix)
 *   B2 — byte-identical to B; generated twice so B-vs-B2 pairs measure the
 *        judge's false-preference floor on temperature sampling alone
 *   C  — the pre-decided remedy: B with OUTPUT_CONSTRAINTS moved to the
 *        recency tail (built ONLY if A-vs-B fails the gate)
 *
 * Arm C is a string transform on B's system output rather than a re-derived
 * assembly: it moves the known OUTPUT_CONSTRAINTS constant from the S0 prefix
 * to the tail and hard-errors if B's shape ever stops matching — so C cannot
 * silently drift from production B.
 */

import { PromptBuilder } from '../PromptBuilder.js';
import { PLATFORM_CONSTRAINTS, OUTPUT_CONSTRAINTS } from '../prompt/HardcodedConstraints.js';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type {
  MemoryDocument,
  ConversationContext,
  ParticipantInfo,
  FactForPrompt,
} from '../ConversationalRAGTypes.js';
import { legacyBuildSystemPrompt, legacyBuildHumanMessage } from './legacyPromptAssembly.js';

export type ArmId = 'A' | 'B' | 'B2' | 'C';
export const ARM_IDS: readonly ArmId[] = ['A', 'B', 'B2', 'C'] as const;

/** One probe's frozen input bundle — shared by every arm. */
export interface ProbeInputs {
  personality: LoadedPersonality;
  context: ConversationContext;
  participantPersonas: Map<string, ParticipantInfo>;
  /** Pre-serialized <message …> XML body — serialized ONCE per probe. */
  serializedHistory: string;
  relevantMemories: MemoryDocument[];
  facts: FactForPrompt[];
  referencedMessagesFormatted?: string;
  /** The trigger turn's text (stored attachment text already inline). */
  userMessage: string;
}

export interface ArmMessages {
  system: string;
  human: string;
}

/** Move OUTPUT_CONSTRAINTS from B's S0 prefix to the recency tail (arm C). */
export function moveOutputConstraintsToTail(systemB: string): string {
  const lead = `${PLATFORM_CONSTRAINTS}\n\n${OUTPUT_CONSTRAINTS}`;
  if (!systemB.startsWith(lead)) {
    throw new Error(
      'Arm C transform: the system message no longer starts with the platform+output S0 pair — production assembly changed; update the remedy transform.'
    );
  }
  return `${PLATFORM_CONSTRAINTS}${systemB.slice(lead.length)}\n\n${OUTPUT_CONSTRAINTS}`;
}

function messageText(content: unknown): string {
  if (typeof content !== 'string') {
    throw new Error('Expected a string message content from PromptBuilder');
  }
  return content;
}

function buildCurrentArm(inputs: ProbeInputs): ArmMessages {
  const builder = new PromptBuilder();
  const system = messageText(
    builder.buildSystemMessage({
      personality: inputs.personality,
      context: inputs.context,
      serializedHistory: inputs.serializedHistory,
    }).message.content
  );
  const volatilePrefix = builder.buildVolatilePrefix({
    personality: inputs.personality,
    context: inputs.context,
    participantPersonas: inputs.participantPersonas,
    referencedMessagesFormatted: inputs.referencedMessagesFormatted,
    facts: inputs.facts,
    relevantMemories: inputs.relevantMemories,
  });
  const human = messageText(
    builder.buildHumanMessage(inputs.userMessage, [], {
      activePersonaName: inputs.context.activePersonaName,
      volatilePrefix,
      activePersonaId: inputs.context.activePersonaId,
      discordUsername: inputs.context.discordUsername,
      personalityName: inputs.personality.name,
    }).message.content
  );
  return { system, human };
}

function buildLegacyArm(inputs: ProbeInputs): ArmMessages {
  const system = legacyBuildSystemPrompt({
    personality: inputs.personality,
    participantPersonas: inputs.participantPersonas,
    relevantMemories: inputs.relevantMemories,
    facts: inputs.facts,
    context: inputs.context,
    referencedMessagesFormatted: inputs.referencedMessagesFormatted,
    serializedHistory: inputs.serializedHistory,
  });
  // The old shape double-rendered references: system section AND user-turn append.
  const human = legacyBuildHumanMessage(inputs.userMessage, {
    activePersonaName: inputs.context.activePersonaName,
    referencedMessagesDescriptions: inputs.referencedMessagesFormatted,
    activePersonaId: inputs.context.activePersonaId,
    discordUsername: inputs.context.discordUsername,
    personalityName: inputs.personality.name,
  });
  return { system, human };
}

/**
 * Render one arm's (system, human) pair from the shared bundle. Callers pin
 * the clock (fake timers at the probe instant) — both assemblies read
 * `new Date()` for the `<context>` datetime.
 */
export function buildArmMessages(arm: ArmId, inputs: ProbeInputs): ArmMessages {
  switch (arm) {
    case 'A':
      return buildLegacyArm(inputs);
    case 'B':
    case 'B2':
      return buildCurrentArm(inputs);
    case 'C': {
      const current = buildCurrentArm(inputs);
      return { system: moveOutputConstraintsToTail(current.system), human: current.human };
    }
  }
}
