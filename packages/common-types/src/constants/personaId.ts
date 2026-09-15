/**
 * Internal placeholder prefix for Discord user IDs before persona resolution.
 *
 * Writers (bot-client's DiscordChannelFetcher, ReactionProcessor,
 * ParticipantContextCollector) build ConversationMessage / reactor records
 * with `personaId = discord:{discordId}` before any identity lookup;
 * `resolveExtendedContextPersonaIds()` resolves registered users to UUIDs
 * and strips the placeholder for unregistered ones.
 *
 * The raw assembly envelope carries the PRE-resolution snapshot across the
 * bot-client → ai-worker boundary on purpose: the worker-side context
 * assembler runs the resolution — which is why both the constant and the
 * resolver live here rather than in either service.
 */
export const INTERNAL_DISCORD_ID_PREFIX = 'discord:';
