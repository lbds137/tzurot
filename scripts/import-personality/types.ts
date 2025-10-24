/**
 * Shapes.inc Personality Import Tool - Type Definitions
 *
 * Maps shapes.inc backup format to Tzurot v3 PostgreSQL schema
 */

// ============================================================================
// Shapes.inc Format (source)
// ============================================================================

export interface ShapesIncPersonalityConfig {
  // Identity
  id: string; // Shapes.inc UUID
  name: string; // Display name (e.g., "COLD")
  username: string; // Slug (e.g., "cold-kerach-batuach")
  avatar: string; // URL to shapes.inc avatar

  // Core prompting
  jailbreak: string; // System prompt
  user_prompt: string; // Character info/background

  // Personality traits
  personality_traits: string;
  personality_tone?: string;
  personality_age?: string;
  personality_likes?: string;
  personality_dislikes?: string;
  personality_conversational_goals?: string;
  personality_conversational_examples?: string;

  // LLM parameters
  engine_model: string; // Model name (e.g., "openai/gpt-oss-120b")
  fallback_engine_model?: string;
  engine_temperature: number;
  engine_top_p?: number;
  engine_top_k?: number;
  engine_frequency_penalty?: number;
  engine_presence_penalty?: number;
  engine_repetition_penalty?: number;
  engine_min_p?: number;
  engine_top_a?: number;

  // Memory settings
  stm_window: number; // Context window size
  ltm_enabled: boolean;
  ltm_threshold: number; // Memory score threshold
  ltm_max_retrieved_summaries: number; // Memory limit

  // Voice (ignore for v3)
  voice_model?: string;
  voice_id?: string;
  voice_frequency?: number;
  voice_stability?: number;
  voice_similarity?: number;
  voice_style?: number;
  voice_transcription_enabled?: boolean;

  // Image (ignore for v3)
  image_model?: string;
  image_size?: string;
  force_image_size?: boolean;

  // Custom fields we want to preserve
  favorite_reacts?: string[]; // Emoji reactions personality can use
  keywords?: string[]; // Keywords for discovery/search
  search_description?: string; // Brief personality description
  error_message?: string; // Custom error message
  wack_message?: string; // Custom reset message
  sleep_message?: string; // Custom offline message

  // Other fields we ignore
  [key: string]: any;
}

export interface ShapesIncMemory {
  id: string; // Format: "{msg_uuid_1}/{msg_uuid_last}"
  shape_id: string; // Shapes.inc personality UUID
  senders: string[]; // Shapes.inc user UUIDs
  result: string; // The LTM summary text
  metadata: {
    start_ts: number; // Unix timestamp (seconds)
    end_ts: number;
    created_at: number;
    senders: string[];
    discord_channel_id?: string;
    discord_guild_id?: string;
  };
}

export interface ShapesIncChatMessage {
  id: string;
  shape_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  [key: string]: any;
}

// ============================================================================
// V3 Format (target)
// ============================================================================

export interface V3PersonalityData {
  // Core personality
  personality: {
    name: string; // Display name
    displayName: string | null;
    slug: string; // URL-friendly slug
    avatarUrl: string; // Local or Railway URL
    characterInfo: string;
    personalityTraits: string;
    personalityTone: string | null;
    personalityAge: string | null;
    personalityLikes: string | null;
    personalityDislikes: string | null;
    conversationalGoals: string | null;
    conversationalExamples: string | null;
    memoryEnabled: boolean;
    voiceEnabled: boolean;
    imageEnabled: boolean;
    customFields: Record<string, any> | null; // Extra fields like favorite_reacts, keywords
  };

  // System prompt
  systemPrompt: {
    name: string;
    description: string | null;
    content: string;
    isDefault: boolean;
  };

  // LLM config
  llmConfig: {
    name: string;
    description: string | null;
    model: string; // OpenRouter format
    visionModel: string | null;
    temperature: number;
    topP: number | null;
    topK: number | null;
    frequencyPenalty: number | null;
    presencePenalty: number | null;
    repetitionPenalty: number | null;
    maxTokens: number | null;
    memoryScoreThreshold: number | null;
    memoryLimit: number | null;
    contextWindowSize: number;
    isGlobal: boolean;
    ownerId: string | null;
  };
}

export interface V3MemoryMetadata {
  personaId: string; // V3 persona UUID
  personalityId: string; // V3 personality UUID
  personalityName: string;
  sessionId: string | null;
  canonScope: 'personal' | 'shared';
  timestamp: number; // Milliseconds
  summaryType: 'conversation';
  contextType: 'dm' | 'guild';
  channelId?: string;
  guildId?: string;
  serverId?: string;
}

// ============================================================================
// Import Tool Types
// ============================================================================

export interface PersonalityImportResult {
  v3PersonalityId: string;
  shapesPersonalityId: string;
  name: string;
  slug: string;
  systemPromptId: string;
  llmConfigId: string;
  defaultLinkId: string;
  avatarPath: string; // Local file path
  avatarUrl: string; // Public URL
}

export interface MemoryImportResult {
  imported: number;
  skipped: number;
  failed: number;
  orphaned: number;
  errors: Array<{ memoryId: string; error: string }>;
}

export interface UUIDMapping {
  shapesPersonalityId: string;
  v3PersonalityId: string;
  shapesUserIdToDiscordId: Map<string, string>;
  v3UserIdToPersonaId: Map<string, string>;
}

export interface ImportOptions {
  // Import modes
  fullImport: boolean; // Import personality + memories
  memoriesOnly: boolean; // Skip personality creation
  regenerateLTMs: boolean; // Create new LTMs from chat history
  dryRun: boolean; // Parse but don't write

  // Conflict handling
  force: boolean; // Overwrite existing personality
  renameTo?: string; // Rename slug if conflict

  // Memory handling
  orphanedPersonaId?: string; // UUID for orphaned memories
  skipExistingMemories: boolean; // Don't re-import

  // Avatar handling
  downloadAvatar: boolean; // Download from shapes.inc
  avatarStoragePath: string; // Local storage path
  apiGatewayUrl: string; // Base URL for serving
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    memoriesCount: number;
    chatMessagesCount: number;
    uniqueUsers: number;
    orphanedUsers: number;
    dateRange: {
      earliest: Date;
      latest: Date;
    } | null;
  };
}

export interface ImportContext {
  personalitySlug: string;
  basePath: string; // tzurot-legacy/data/personalities/{slug}
  options: ImportOptions;
  uuidMapping: UUIDMapping;
}
