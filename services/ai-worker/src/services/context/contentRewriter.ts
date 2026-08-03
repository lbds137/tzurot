/**
 * Worker-side message-content rewriting.
 *
 * Re-derives the payload's `message` surface (and the mentionedPersonas /
 * referencedChannels context fields) from the envelope's raw inputs,
 * mirroring bot-client's step-5 pipeline in the same order:
 *
 * 1. `[Reference N]` link replacement — the link map is reconstructed from
 *    the raw references' wire-adopted numbers: parse Discord message links
 *    from the raw content, map each URL's messageId to a reference number
 *    (LAST number wins per messageId, mirroring trackLink's Map.set
 *    last-wins for multi-snapshot forwards). URLs whose messageId matches
 *    no reference stay raw — the bot leaves unfetchable links untouched too.
 * 2. User mentions (shared kernel) — targets from rawMentionedUsers, with
 *    the worker's own user/persona services and DB fallback.
 * 3. Channel then role mentions (shared kernels) — lookups over the
 *    envelope's capture-time raw lists. The lists were built from the SAME
 *    kernel scan bot-side, so within-cap resolvable ids are present and
 *    everything else placeholders/passes through identically.
 *
 * This output REPLACES `job.data.message` unconditionally (ContextStep
 * applies it; there is no legacy fallback to the payload's own copy).
 *
 * Voice triggers: `rawMessageContent` is `''` by producer contract — the
 * spoken words are not in this input and never enter the rewritten message.
 * The transcript reaches the current turn solely via the worker's own
 * transcription on the attachment-description path, which is what keeps it
 * from appearing twice. (`rawRoutingTranscript`, the bot-side STT copy, is
 * telemetry-only and is not read here.)
 */

import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import {
  type MentionedPersona,
  type ReferencedChannel,
} from '@tzurot/common-types/types/schemas/personality';
import { type RawAssemblyInputs } from '@tzurot/common-types/types/schemas/rawEnvelope';
import {
  resolveUserMentions,
  rewriteChannelMentions,
  rewriteRoleMentions,
  type MentionTargetUser,
  type UserMentionDeps,
} from '@tzurot/common-types/utils/mentionRewriter';
import { MessageLinkParser } from '@tzurot/common-types/utils/messageLinkParser';

export interface RewriteRawContentParams {
  raw: RawAssemblyInputs;
  /**
   * Raw reference snapshots (wire numbering) — the [Reference N] link
   * sources. Callers pass raw.rawReferencedMessages.
   */
  rawReferences: ReferencedMessage[] | undefined;
  personalityId: string;
  deps: UserMentionDeps;
}

export interface RewrittenContent {
  messageContent: string;
  mentionedPersonas: MentionedPersona[] | undefined;
  referencedChannels: ReferencedChannel[] | undefined;
}

/** Reconstruct the URL → reference-number map from raw references. */
function buildLinkMap(
  content: string,
  rawReferences: ReferencedMessage[] | undefined
): Map<string, number> {
  const linkMap = new Map<string, number>();
  if (rawReferences === undefined || rawReferences.length === 0) {
    return linkMap;
  }

  // Wire order + Map.set = last number wins per messageId, mirroring the
  // bot-side trackLink behavior for multi-snapshot forwards.
  const numberByMessageId = new Map<string, number>();
  for (const ref of rawReferences) {
    numberByMessageId.set(ref.discordMessageId, ref.referenceNumber);
  }

  for (const link of MessageLinkParser.parseMessageLinks(content)) {
    const referenceNumber = numberByMessageId.get(link.messageId);
    if (referenceNumber !== undefined) {
      linkMap.set(link.fullUrl, referenceNumber);
    }
  }
  return linkMap;
}

/**
 * Rewrite the raw message content through the shared kernels. Mirrors the
 * bot-side order exactly: links → user mentions → channels → roles.
 */
export async function rewriteRawContent(
  params: RewriteRawContentParams
): Promise<RewrittenContent> {
  const { raw, rawReferences, personalityId, deps } = params;

  // 1. [Reference N] link replacement (shared parser + replacer).
  let content = MessageLinkParser.replaceLinksWithReferences(
    raw.rawMessageContent,
    buildLinkMap(raw.rawMessageContent, rawReferences)
  );

  // 2. User mentions — targets from the envelope's mention capture.
  const targets = new Map<string, MentionTargetUser>(
    (raw.rawMentionedUsers ?? []).map(u => [
      u.discordId,
      {
        discordId: u.discordId,
        username: u.username,
        displayName: u.displayName,
        isBot: u.isBot ?? false,
      },
    ])
  );
  const userResult = await resolveUserMentions(content, targets, personalityId, deps);
  content = userResult.processedContent;

  // 3. Channel mentions — capture-time raw list as the lookup.
  const channelById = new Map((raw.rawMentionedChannels ?? []).map(c => [c.channelId, c]));
  const channelResult = rewriteChannelMentions(content, id => channelById.get(id) ?? null);
  content = channelResult.processedContent;

  // 4. Role mentions — names rewritten into content; the resolved list is
  // NOT surfaced (payload parity: JobContext carries no mentioned-roles
  // field).
  const roleById = new Map((raw.rawMentionedRoles ?? []).map(r => [r.roleId, r]));
  const roleResult = rewriteRoleMentions(content, id => roleById.get(id) ?? null);
  content = roleResult.processedContent;

  return {
    messageContent: content,
    // Payload shape parity: both fields are omitted when empty.
    mentionedPersonas:
      userResult.mentionedUsers.length > 0
        ? userResult.mentionedUsers.map(u => ({
            personaId: u.personaId,
            personaName: u.personaName,
          }))
        : undefined,
    // RawMentionedChannel is structurally identical to ReferencedChannel —
    // pass the kernel's list through rather than re-mapping (an explicit
    // mapping would write `topic: undefined` props that could false-diverge
    // a future deep-equality diff).
    referencedChannels:
      channelResult.mentionedChannels.length > 0 ? channelResult.mentionedChannels : undefined,
  };
}
