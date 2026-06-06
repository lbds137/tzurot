/**
 * Internal placeholder prefix for Discord user IDs before persona resolution.
 *
 * Writers (bot-client's DiscordChannelFetcher, ReactionProcessor,
 * ParticipantContextCollector) build ConversationMessage / reactor records
 * with `personaId = discord:{discordId}` before any identity lookup;
 * `resolveExtendedContextPersonaIds()` resolves registered users to UUIDs
 * and strips the placeholder for unregistered ones.
 *
 * Since the raw assembly envelope (CONTEXT_RAW_ENVELOPE), the PRE-resolution
 * snapshot deliberately crosses the bot-client → ai-worker boundary so the
 * worker-side context assembler can re-run the same resolution — which is
 * why both the constant and the resolver live here rather than in bot-client.
 */
export const INTERNAL_DISCORD_ID_PREFIX = 'discord:';
