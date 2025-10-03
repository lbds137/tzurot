/**
 * Personality Loader - Loads personality configurations from files or database
 *
 * Supports multiple sources:
 * - JSON files in a personalities/ directory
 * - Database (for production with BYOK configs per user)
 * - In-memory registry for testing
 */

import { Personality, createLogger } from '@tzurot/common-types';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

const logger = createLogger('PersonalityLoader');

export class PersonalityLoader {
  private personalities = new Map<string, Personality>();
  private personalitiesDir: string;

  constructor(personalitiesDir = './personalities') {
    this.personalitiesDir = personalitiesDir;
  }

  /**
   * Load all personalities from the personalities directory
   */
  async loadFromDirectory(): Promise<void> {
    try {
      logger.info(`[PersonalityLoader] Loading personalities from ${this.personalitiesDir}`);

      const files = await readdir(this.personalitiesDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      logger.info(`[PersonalityLoader] Found ${jsonFiles.length} personality files`);

      for (const file of jsonFiles) {
        try {
          const filePath = join(this.personalitiesDir, file);
          const content = await readFile(filePath, 'utf-8');
          const personality = JSON.parse(content) as Personality;

          // Validate required fields
          if (!personality.name) {
            logger.warn(`[PersonalityLoader] Skipping ${file} - missing name field`);
            continue;
          }

          this.personalities.set(personality.name.toLowerCase(), personality);
          logger.debug(`[PersonalityLoader] Loaded personality: ${personality.name}`);
        } catch (error) {
          logger.error(`[PersonalityLoader] Failed to load ${file}:`, error);
        }
      }

      logger.info(`[PersonalityLoader] Successfully loaded ${this.personalities.size} personalities`);
    } catch (error) {
      logger.error('[PersonalityLoader] Failed to load personalities from directory:', error);
      throw error;
    }
  }

  /**
   * Get a personality by name
   */
  getPersonality(name: string): Personality | undefined {
    return this.personalities.get(name.toLowerCase());
  }

  /**
   * Get all personalities
   */
  getAllPersonalities(): Personality[] {
    return Array.from(this.personalities.values());
  }

  /**
   * Add or update a personality (in-memory)
   */
  setPersonality(personality: Personality): void {
    this.personalities.set(personality.name.toLowerCase(), personality);
    logger.debug(`[PersonalityLoader] Set personality: ${personality.name}`);
  }

  /**
   * Check if a personality exists
   */
  hasPersonality(name: string): boolean {
    return this.personalities.has(name.toLowerCase());
  }

  /**
   * Remove a personality
   */
  removePersonality(name: string): boolean {
    const removed = this.personalities.delete(name.toLowerCase());
    if (removed) {
      logger.debug(`[PersonalityLoader] Removed personality: ${name}`);
    }
    return removed;
  }

  /**
   * Get count of loaded personalities
   */
  getCount(): number {
    return this.personalities.size;
  }
}
