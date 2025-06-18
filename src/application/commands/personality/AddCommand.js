/**
 * Add personality command - Platform-agnostic implementation
 * @module application/commands/personality/AddCommand
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Create the add personality command
 */
function createAddCommand() {
  return new Command({
    name: 'add',
    description: 'Add a new personality to the bot',
    category: 'personality',
    aliases: ['create', 'new'],
    permissions: ['USER'],
    options: [
      new CommandOption({
        name: 'name',
        description: 'The name of the personality',
        type: 'string',
        required: true,
      }),
      new CommandOption({
        name: 'prompt',
        description: 'The personality prompt (optional)',
        type: 'string',
        required: false,
      }),
      new CommandOption({
        name: 'model',
        description: 'The AI model path (optional)',
        type: 'string',
        required: false,
      }),
      new CommandOption({
        name: 'maxwords',
        description: 'Maximum word count for responses (optional)',
        type: 'integer',
        required: false,
      }),
      new CommandOption({
        name: 'alias',
        description: 'An alias/nickname for the personality (optional)',
        type: 'string',
        required: false,
      }),
    ],
    execute: async context => {
      try {
        // Extract dependencies
        const personalityService = context.dependencies.personalityApplicationService;
        const featureFlags = context.dependencies.featureFlags;

        if (!personalityService) {
          throw new Error('PersonalityApplicationService not available');
        }

        // Get arguments based on command type
        let name, prompt, modelPath, maxWordCount, alias;

        if (context.isSlashCommand) {
          // Slash command - options are named
          name = context.options.name;
          prompt = context.options.prompt;
          modelPath = context.options.model;
          maxWordCount = context.options.maxwords;
          alias = context.options.alias;
        } else {
          // Text command - parse positional arguments
          if (context.args.length < 1) {
            return await context.respond(
              'Usage: `!tz add <name> [alias] [prompt]`\n' +
                'Examples:\n' +
                '`!tz add Claude` - Creates Claude with default prompt\n' +
                '`!tz add Claude claude-alias` - Creates Claude with an alias\n' +
                '`!tz add Claude "You are Claude, a helpful AI assistant"` - Creates Claude with custom prompt\n' +
                '`!tz add Claude claude-alias "You are Claude, a helpful AI assistant"` - Creates Claude with alias and custom prompt'
            );
          }

          name = context.args[0];

          // Check if second argument is an alias (single word without quotes) or start of prompt
          if (context.args.length > 1) {
            const secondArg = context.args[1];
            const isQuotedPrompt = secondArg.startsWith('"') || secondArg.startsWith("'");
            const hasSpaceInSecondArg = context.args.length === 2 && secondArg.includes(' ');

            // Check if second argument looks like it could be an alias (single word)
            const looksLikeAlias =
              !isQuotedPrompt &&
              !hasSpaceInSecondArg &&
              context.args.length === 2 &&
              !secondArg.includes(' ');

            if (looksLikeAlias) {
              // It looks like an alias, validate the format
              if (!/^[a-zA-Z0-9_-]+$/.test(secondArg)) {
                return await context.respond(
                  'Aliases can only contain letters, numbers, underscores, and hyphens.'
                );
              }
              alias = secondArg;
            } else if (!isQuotedPrompt && context.args.length > 2) {
              // Multiple arguments - check if second could be an alias
              const isValidAlias = /^[a-zA-Z0-9_-]+$/.test(secondArg);
              const thirdArg = context.args[2];

              // If it looks like alias + prompt pattern
              if (
                isValidAlias &&
                thirdArg &&
                (thirdArg[0] === thirdArg[0].toUpperCase() || thirdArg.toLowerCase() === 'you')
              ) {
                alias = secondArg;
                prompt = context.args.slice(2).join(' ');
              } else {
                // Otherwise, treat everything after name as prompt
                prompt = context.args.slice(1).join(' ');
              }
            } else {
              // Second argument starts with quote or is multi-word - treat as prompt
              prompt = context.args.slice(1).join(' ');
            }

            // Remove quotes from prompt if present
            if (prompt) {
              if (
                (prompt.startsWith('"') && prompt.endsWith('"')) ||
                (prompt.startsWith("'") && prompt.endsWith("'"))
              ) {
                prompt = prompt.slice(1, -1);
              }
            }
          }
        }

        // Validate personality name
        if (!name || name.length < 2) {
          return await context.respond('Personality name must be at least 2 characters long.');
        }

        if (name.length > 50) {
          return await context.respond('Personality name must be 50 characters or less.');
        }

        logger.info(`[AddCommand] Creating personality "${name}" for user ${context.getUserId()}`);

        // Alias validation already happened during parsing

        // Create the personality
        const command = {
          name: name,
          ownerId: context.getUserId(),
          prompt: prompt || `You are ${name}`,
          modelPath: modelPath || '/default',
          maxWordCount: maxWordCount || 1000,
          aliases: alias ? [alias] : [], // Include alias if provided
        };

        try {
          const personality = await personalityService.registerPersonality(command);

          logger.info(`[AddCommand] Successfully created personality "${name}"`);

          let response = `✅ Successfully created personality **${name}**`;
          if (alias) {
            response += `\nAlias: **${alias}**`;
          }
          if (prompt) {
            response += `\nPrompt: "${prompt}"`;
          }

          return await context.respond(response);
        } catch (error) {
          // Handle specific errors
          if (error.message.includes('already exists')) {
            return await context.respond(
              `A personality named **${name}** already exists. ` +
                `Please choose a different name or use \`remove\` first.`
            );
          }

          if (error.message.includes('Authentication failed')) {
            return await context.respond(
              '❌ Authentication failed. Please make sure you have authenticated with the bot first.\n' +
                'Use `!tz auth` to authenticate.'
            );
          }

          throw error; // Re-throw other errors
        }
      } catch (error) {
        logger.error('[AddCommand] Error:', error);

        return await context.respond(
          '❌ An error occurred while creating the personality. ' +
            'Please try again later or contact support if the issue persists.'
        );
      }
    },
  });
}

module.exports = { createAddCommand };
