import { type ClientOptions, GatewayIntentBits, Partials } from 'discord.js';
import { discordRestOptions } from '@tzurot/common-types/utils/discordInstanceOrigin';

/**
 * Build the `discord.js` `Client` options, additively overriding REST/CDN
 * endpoints when a self-hosted instance origin is configured. Unset
 * `instanceOrigin` returns the exact options object used before the
 * instance-origin feature existed — no `rest` key at all — so unset stays
 * byte-identical to today's behavior.
 *
 * Note: GuildMembers is a privileged intent requiring Discord Portal approval for 100+ servers.
 * It's required because without it, message.member is null and we can't access user roles,
 * display color, or join date for the AI context (activePersonaGuildInfo).
 * Note: Partials.Channel + Message + User are all required for DM events to
 * reliably fire after a process restart. Empirical diagnosis (raw-gateway
 * listener): with only Partials.Channel, DM MESSAGE_CREATE
 * packets reach the gateway listener but Discord.js silently drops them
 * before MessageCreate fires. The DM channel↔user resolution path needs
 * the user to be a partial when uncached (every fresh restart), and
 * Message partial covers reference-resolution edge cases.
 *
 * Forward-protection: Partials.Message also means any future
 * MESSAGE_UPDATE/DELETE handler must guard against partial Message
 * objects (check `message.partial === true` and fetch before accessing
 * `content`, `author`, etc.). MESSAGE_CREATE payloads are always
 * complete per Discord protocol, so the create path is unaffected.
 */
export function buildDiscordClientOptions(instanceOrigin: string | undefined): ClientOptions {
  const options: ClientOptions = {
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildWebhooks,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User],
    // Disable all mention parsing from message content to prevent AI-generated
    // @everyone/@here/@role pings. Reply-pings (repliedUser) are unaffected.
    allowedMentions: { parse: [] },
  };

  const rest = discordRestOptions(instanceOrigin);
  return rest === undefined ? options : { ...options, rest };
}
