/**
 * Personality Loader
 *
 * Loads personality configurations from JSON files.
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { createLogger, MODEL_DEFAULTS } from '@tzurot/common-types';
import type { BotPersonality } from '../types.js';

const logger = createLogger('PersonalityLoader');

/**
 * Load personalities from JSON files
 */
export async function loadPersonalities(personalitiesDir: string): Promise<Map<string, BotPersonality>> {
  const personalities = new Map<string, BotPersonality>();

  try {
    const files = await readdir(personalitiesDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    logger.info(`[PersonalityLoader] Found ${jsonFiles.length} personality files`);

    for (const file of jsonFiles) {
      try {
        const filePath = join(personalitiesDir, file);
        const content = await readFile(filePath, 'utf-8');
        const rawConfig = JSON.parse(content) as unknown;

        // Validate structure - TypeScript will enforce type checking with 'unknown'
        if (
          typeof rawConfig !== 'object' || rawConfig === null ||
          !('name' in rawConfig) || typeof rawConfig.name !== 'string' ||
          !('systemPrompt' in rawConfig) || typeof rawConfig.systemPrompt !== 'string'
        ) {
          throw new Error(`Invalid personality config in ${file}: missing required fields`);
        }

        // Normalize the personality config
        const config: BotPersonality = {
          name: rawConfig.name,
          displayName: ('displayName' in rawConfig && typeof rawConfig.displayName === 'string')
            ? rawConfig.displayName
            : rawConfig.name,
          systemPrompt: rawConfig.systemPrompt,
          model: ('model' in rawConfig && typeof rawConfig.model === 'string')
            ? rawConfig.model
            : MODEL_DEFAULTS.DEFAULT_MODEL,
          temperature: ('temperature' in rawConfig && typeof rawConfig.temperature === 'number')
            ? rawConfig.temperature
            : 0.7,
          maxTokens: ('maxTokens' in rawConfig && typeof rawConfig.maxTokens === 'number')
            ? rawConfig.maxTokens
            : 500,
          avatarUrl: (('avatarUrl' in rawConfig && typeof rawConfig.avatarUrl === 'string')
            ? rawConfig.avatarUrl
            : ('avatar' in rawConfig && typeof rawConfig.avatar === 'string')
              ? rawConfig.avatar
              : undefined)
        };

        // Store by lowercase name for case-insensitive lookup
        const key = config.name.toLowerCase();
        personalities.set(key, config);

        logger.info(`[PersonalityLoader] Loaded personality: ${config.name} (display: ${config.displayName})`);

      } catch (error) {
        logger.error({ err: error }, `[PersonalityLoader] Failed to load ${file}`);
      }
    }

    // Add default personality if none loaded
    if (personalities.size === 0) {
      logger.warn('[PersonalityLoader] No personalities loaded, creating default');
      personalities.set('default', createDefaultPersonality());
    }

    return personalities;

  } catch (error) {
    logger.error({ err: error }, '[PersonalityLoader] Failed to load personalities');

    // Return default personality on error
    const personalities = new Map<string, BotPersonality>();
    personalities.set('default', createDefaultPersonality());
    return personalities;
  }
}

/**
 * Create a default personality
 */
function createDefaultPersonality(): BotPersonality {
  return {
    name: 'Assistant',
    displayName: 'AI Assistant',
    systemPrompt: 'You are a helpful AI assistant in a Discord server. Be friendly, concise, and helpful.',
    model: MODEL_DEFAULTS.DEFAULT_MODEL,
    temperature: 0.7,
    maxTokens: 500,
    avatarUrl: undefined
  };
}
