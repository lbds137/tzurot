/**
 * Personality Loader
 *
 * Loads personality configurations from JSON files.
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '@tzurot/common-types';
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
        const rawConfig = JSON.parse(content) as any;

        // Normalize the personality config
        const config: BotPersonality = {
          name: rawConfig.name,
          displayName: rawConfig.displayName || rawConfig.name, // Use name if displayName not provided
          systemPrompt: rawConfig.systemPrompt,
          model: rawConfig.model,
          temperature: rawConfig.temperature,
          maxTokens: rawConfig.maxTokens,
          avatarUrl: rawConfig.avatarUrl || rawConfig.avatar // Support both field names
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
    model: 'anthropic/claude-3.5-sonnet',
    temperature: 0.7,
    maxTokens: 500,
    avatarUrl: undefined
  };
}
