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
      // Extract dependencies early so they're in scope for error handling
      const personalityService = context.dependencies.personalityApplicationService;
      const featureFlags = context.dependencies.featureFlags;
      const requestTracker = context.dependencies.requestTrackingService;
      
      // Variables that might be needed in error handling
      let name, prompt, modelPath, maxWordCount, alias;

      try {
        if (!personalityService) {
          throw new Error('PersonalityApplicationService not available');
        }

        // Get arguments based on command type
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
            const usageEmbed = {
              title: 'How to Add a Personality',
              description: 'Create a new AI personality for your Discord server.',
              color: 0x2196f3, // Blue color
              fields: [
                {
                  name: 'Basic Usage',
                  value: '`!tz add <name> [alias] [prompt]`',
                  inline: false,
                },
                {
                  name: 'Examples',
                  value:
                    '• `!tz add Claude` - Creates Claude with default prompt\n' +
                    '• `!tz add Claude claude-alias` - Creates Claude with an alias\n' +
                    '• `!tz add Claude "You are Claude, a helpful AI assistant"` - Custom prompt\n' +
                    '• `!tz add Claude claude-alias "You are Claude, a helpful AI assistant"` - Alias + prompt',
                  inline: false,
                },
                {
                  name: 'Parameters',
                  value:
                    "• **name** (required): The personality's name\n" +
                    '• **alias** (optional): A shortcut name\n' +
                    '• **prompt** (optional): Custom personality instructions',
                  inline: false,
                },
              ],
              footer: {
                text: 'Pro tip: Aliases make it easier to mention personalities',
              },
            };
            return await context.respond({ embeds: [usageEmbed] });
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
                const aliasErrorEmbed = {
                  title: '❌ Invalid Alias Format',
                  description:
                    'Aliases can only contain letters, numbers, underscores, and hyphens.',
                  color: 0xf44336, // Red color
                  fields: [
                    {
                      name: 'Valid characters',
                      value:
                        '• Letters (a-z, A-Z)\n• Numbers (0-9)\n• Underscores (_)\n• Hyphens (-)',
                      inline: false,
                    },
                    {
                      name: 'Examples',
                      value:
                        '✅ `claude-ai`\n✅ `helper_bot`\n✅ `AI2024`\n❌ `claude.ai`\n❌ `helper bot`\n❌ `AI@2024`',
                      inline: false,
                    },
                  ],
                };
                return await context.respond({ embeds: [aliasErrorEmbed] });
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
          const validationEmbed = {
            title: '❌ Invalid Name',
            description: 'Personality name must be at least 2 characters long.',
            color: 0xf44336, // Red color
            fields: [
              {
                name: 'Requirements',
                value:
                  '• Minimum 2 characters\n• Maximum 50 characters\n• Can include letters, numbers, spaces',
                inline: false,
              },
            ],
          };
          return await context.respond({ embeds: [validationEmbed] });
        }

        if (name.length > 50) {
          const validationEmbed = {
            title: '❌ Name Too Long',
            description: 'Personality name must be 50 characters or less.',
            color: 0xf44336, // Red color
            fields: [
              {
                name: 'Current length',
                value: `${name.length} characters`,
                inline: true,
              },
              {
                name: 'Maximum allowed',
                value: '50 characters',
                inline: true,
              },
            ],
          };
          return await context.respond({ embeds: [validationEmbed] });
        }

        logger.info(`[AddCommand] Creating personality "${name}" for user ${context.getUserId()}`);

        // Check for duplicate requests if tracking service is available
        if (requestTracker) {
          // Check if this message is already being processed
          const messageId = context.getMessageId ? context.getMessageId() : null;
          if (messageId && requestTracker.isMessageProcessing(messageId)) {
            logger.warn(`[AddCommand] Message ${messageId} is already being processed`);
            return null; // Silent failure to prevent duplicate responses
          }

          // Mark message as processing
          if (messageId) {
            requestTracker.markMessageProcessing(messageId);
          }

          // Generate request key for duplicate protection
          const requestKey = requestTracker.generateAddCommandKey(
            context.getUserId(),
            name,
            alias
          );

          // Check if this request can proceed
          const requestStatus = requestTracker.checkRequest(requestKey);
          if (!requestStatus.canProceed) {
            logger.warn(
              `[AddCommand] Duplicate request blocked: ${requestStatus.reason} for key ${requestKey}`
            );
            
            if (requestStatus.isPending) {
              // Request is still in progress, silent failure
              return null;
            } else if (requestStatus.isCompleted) {
              // Request was recently completed, inform the user
              const duplicateEmbed = {
                title: '⚠️ Request Already Processed',
                description: `The personality **${name}** was just created. Please wait a moment before trying again.`,
                color: 0xff9800, // Orange color
                footer: {
                  text: 'This message helps prevent accidental duplicates',
                },
              };
              return await context.respond({ embeds: [duplicateEmbed] });
            }
          }

          // Mark request as pending
          requestTracker.markPending(requestKey, {
            userId: context.getUserId(),
            personalityName: name,
            alias: alias,
          });
        }

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

          // Mark request as completed if tracking
          if (requestTracker) {
            const requestKey = requestTracker.generateAddCommandKey(
              context.getUserId(),
              name,
              alias
            );
            requestTracker.markCompleted(requestKey, {
              success: true,
              personalityId: personality.id?.value,
            });
          }

          // Create embed fields
          const fields = [
            { name: 'Name', value: personality.profile.name || name, inline: true },
            {
              name: 'Display Name',
              value: personality.profile.displayName || personality.profile.name || name,
              inline: true,
            },
          ];

          // Add alias if provided
          if (alias) {
            // Check if an alternate alias was used due to collision
            const actualAlias = personality.alternateAliases && personality.alternateAliases.length > 0
              ? personality.alternateAliases[0]
              : alias;
            
            if (actualAlias !== alias) {
              // Alias was taken, show both requested and actual
              fields.push({
                name: 'Alias',
                value: `${actualAlias} (requested: ${alias})`,
                inline: true,
              });
            } else {
              fields.push({
                name: 'Alias',
                value: alias,
                inline: true,
              });
            }
          }

          // Add prompt field
          fields.push({
            name: 'Prompt',
            value: prompt || `You are ${name}`,
            inline: false,
          });

          // Add model and settings
          fields.push({
            name: 'Model',
            value: modelPath || '/default',
            inline: true,
          });

          fields.push({
            name: 'Max Words',
            value: (maxWordCount || 1000).toString(),
            inline: true,
          });

          // Add owner field
          fields.push({
            name: 'Owner',
            value: `<@${context.getUserId()}>`,
            inline: true,
          });

          // Add system indicator if using new system
          const featureFlags = context.dependencies.featureFlags;
          if (featureFlags?.isEnabled('ddd.personality.write')) {
            fields.push({
              name: 'System',
              value: '🆕 Created with new DDD system',
              inline: false,
            });
          }

          // Add next steps
          fields.push({
            name: 'Next Steps',
            value:
              `• Mention **@${name}** in a channel to start chatting\n` +
              `• Use \`!tz alias ${name} <new-alias>\` to add more aliases\n` +
              `• Use \`!tz info ${name}\` to view personality details`,
            inline: false,
          });

          // Create the embed response
          const embedData = {
            title: '✅ Personality Created Successfully!',
            description: `Your new personality **${personality.profile.displayName || name}** is ready to use!`,
            color: 0x4caf50, // Green color
            fields: fields,
            footer: {
              text: 'Tip: Personalities can have multiple aliases for easier access',
            },
            timestamp: new Date().toISOString(),
          };

          // Add avatar thumbnail if available
          if (personality.avatarUrl) {
            embedData.thumbnail = { url: personality.avatarUrl };
          } else if (personality.profile?.avatarUrl) {
            embedData.thumbnail = { url: personality.profile.avatarUrl };
          }

          // Trigger avatar preloading in the background if service supports it
          if (personalityService.preloadAvatar) {
            personalityService.preloadAvatar(name, context.getUserId()).catch(err => {
              logger.debug(`[AddCommand] Avatar preload error (non-critical): ${err.message}`);
            });
          }

          return await context.respond({ embeds: [embedData] });
        } catch (error) {
          // Mark request as failed if tracking
          if (requestTracker) {
            const requestKey = requestTracker.generateAddCommandKey(
              context.getUserId(),
              name,
              alias
            );
            requestTracker.markFailed(requestKey);
          }

          // Handle specific errors
          if (error.message.includes('already exists')) {
            const errorEmbed = {
              title: '❌ Personality Already Exists',
              description: `A personality named **${name}** already exists.`,
              color: 0xf44336, // Red color
              fields: [
                {
                  name: 'What to do',
                  value:
                    `• Choose a different name for your personality\n` +
                    `• Use \`!tz remove ${name}\` to delete the existing one first\n` +
                    `• Use \`!tz info ${name}\` to see who owns it`,
                  inline: false,
                },
              ],
              footer: {
                text: 'Each personality must have a unique name',
              },
            };
            return await context.respond({ embeds: [errorEmbed] });
          }

          if (error.message.includes('Authentication failed')) {
            const authEmbed = {
              title: '❌ Authentication Required',
              description: 'You need to authenticate before creating personalities.',
              color: 0xff9800, // Orange color
              fields: [
                {
                  name: 'How to authenticate',
                  value:
                    '1. Use `!tz auth` to start authentication\n' +
                    '2. Follow the instructions in the DM\n' +
                    '3. Try creating your personality again',
                  inline: false,
                },
              ],
              footer: {
                text: 'Authentication ensures secure personality management',
              },
            };
            return await context.respond({ embeds: [authEmbed] });
          }

          throw error; // Re-throw other errors
        }
      } catch (error) {
        logger.error('[AddCommand] Error:', error);

        // Mark request as failed if tracking and we have the name
        // Try to get name from args if not already set
        if (requestTracker) {
          const nameToUse = name || (context.args && context.args[0]) || null;
          if (nameToUse) {
            const requestKey = requestTracker.generateAddCommandKey(
              context.getUserId(),
              nameToUse,
              alias
            );
            requestTracker.markFailed(requestKey);
          }
        }

        const genericErrorEmbed = {
          title: '❌ Something Went Wrong',
          description: 'An error occurred while creating the personality.',
          color: 0xf44336, // Red color
          fields: [
            {
              name: 'What happened',
              value: error.message || 'Unknown error',
              inline: false,
            },
            {
              name: 'What to do',
              value:
                '• Try again in a moment\n• Check your command syntax\n• Contact support if the issue persists',
              inline: false,
            },
          ],
          footer: {
            text: `Error ID: ${Date.now()}`,
          },
          timestamp: new Date().toISOString(),
        };

        return await context.respond({ embeds: [genericErrorEmbed] });
      }
    },
  });
}

module.exports = { createAddCommand };
