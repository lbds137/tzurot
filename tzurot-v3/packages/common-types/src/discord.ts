/**
 * Discord-related types
 */

export interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    discriminator?: string;
    bot: boolean;
  };
  channelId: string;
  guildId?: string;
  webhookId?: string;
  attachments?: Array<{
    name: string;
    url: string;
    contentType?: string;
    size: number;
  }>;
  reference?: {
    messageId: string;
    channelId: string;
    guildId?: string;
  };
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'dm' | 'thread';
  nsfw?: boolean;
  guildId?: string;
}