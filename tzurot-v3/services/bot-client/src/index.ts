import { Client, GatewayIntentBits, Message, Events } from 'discord.js';
import pino from 'pino';
import { AIProviderFactory } from '@tzurot/api-clients';
import { Personality } from '@tzurot/common-types';

// Initialize logger
const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  }
});

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ]
});

// Initialize AI provider
const aiProvider = AIProviderFactory.fromEnv();

// Temporary in-memory personality storage (replace with proper database later)
const personalities = new Map<string, Personality>();

// Example personality
const examplePersonality: Personality = {
  id: 'default-assistant',
  name: 'Assistant',
  displayName: 'AI Assistant',
  systemPrompt: 'You are a helpful AI assistant in a Discord server. Be friendly, concise, and helpful.',
  model: 'anthropic/claude-3.5-sonnet',
  temperature: 0.7,
  maxTokens: 500,
  responseStyle: 'concise',
  formality: 'neutral',
  memoryEnabled: true,
  contextWindow: 10,
  blockedUsers: [],
  nsfwAllowed: false,
  rateLimitPerUser: 10,
  rateLimitGlobal: 100,
  createdBy: 'system',
  createdAt: new Date(),
  updatedAt: new Date(),
  active: true,
  aliases: ['ai', 'bot'],
};

personalities.set('default', examplePersonality);

// Message handler
client.on(Events.MessageCreate, async (message: Message) => {
  try {
    // Ignore bot messages
    if (message.author.bot) return;
    
    // Check if message mentions the bot or uses a command prefix
    const botMentioned = message.mentions.has(client.user!);
    const hasPrefix = message.content.startsWith('!ai');
    
    if (!botMentioned && !hasPrefix) return;
    
    // Clean the message content
    let content = message.content;
    if (botMentioned) {
      content = content.replace(/<@!?\\d+>/g, '').trim();
    }
    if (hasPrefix) {
      content = content.slice(3).trim();
    }
    
    if (!content) {
      await message.reply('How can I help you?');
      return;
    }
    
    logger.info({ 
      user: message.author.tag, 
      channel: message.channel.id,
      content: content.substring(0, 100) 
    }, 'Processing message');
    
    // Get the personality (using default for now)
    const personality = personalities.get('default')!;
    
    // Show typing indicator
    await message.channel.sendTyping();
    
    // Call AI provider
    const response = await aiProvider.complete({
      model: personality.model,
      messages: [
        { role: 'system', content: personality.systemPrompt },
        { role: 'user', content: content }
      ],
      temperature: personality.temperature,
      max_tokens: personality.maxTokens,
    });
    
    const reply = response.choices[0]?.message?.content;
    
    if (!reply) {
      await message.reply('I couldn\\'t generate a response. Please try again.');
      return;
    }
    
    // Send response (split if too long for Discord)
    if (reply.length <= 2000) {
      await message.reply(reply);
    } else {
      // Split into chunks
      const chunks = reply.match(/.{1,2000}/g) || [];
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    }
    
    logger.info({ 
      user: message.author.tag,
      responseLength: reply.length 
    }, 'Response sent');
    
  } catch (error) {
    logger.error(error, 'Error processing message');
    await message.reply('Sorry, I encountered an error. Please try again later.');
  }
});

// Ready event
client.once(Events.ClientReady, () => {
  logger.info(`Logged in as ${client.user?.tag}`);
  logger.info(`AI Provider: ${aiProvider.name}`);
});

// Error handling
client.on(Events.Error, (error) => {
  logger.error(error, 'Discord client error');
});

process.on('unhandledRejection', (error) => {
  logger.error(error, 'Unhandled rejection');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  client.destroy();
  process.exit(0);
});

// Start the bot
async function start() {
  try {
    // Health check AI provider
    const isHealthy = await aiProvider.healthCheck();
    if (!isHealthy) {
      logger.warn('AI provider health check failed, but continuing...');
    }
    
    // Login to Discord
    await client.login(process.env.DISCORD_TOKEN);
  } catch (error) {
    logger.error(error, 'Failed to start bot');
    process.exit(1);
  }
}

start();