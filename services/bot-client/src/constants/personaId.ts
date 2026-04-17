/**
 * Internal placeholder prefix for Discord user IDs before persona resolution.
 *
 * Used by DiscordChannelFetcher, ReactionProcessor, and ParticipantContextCollector
 * when building ConversationMessage / reactor records from Discord API data, before
 * any identity lookup. `resolveExtendedContextPersonaIds()` in contextBuilder is the
 * only code path that should process this format — it either resolves to a UUID
 * (registered user) or strips the placeholder (unregistered user). The format must
 * not cross the bot-client → ai-worker boundary.
 *
 * Lives in a shared constants module so service-layer files don't have to import
 * from the contextBuilder subdirectory — the constant is a leaf value with no
 * behavior attached, and the cross-layer import was an architectural smell.
 */
export const INTERNAL_DISCORD_ID_PREFIX = 'discord:';
