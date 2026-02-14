-- Data Migration: Copy non-default LlmConfig values into config cascade JSONB columns
--
-- This migration populates the config cascade tiers from existing LlmConfig values:
--   1. PersonalityDefaultConfig → Personality.config_defaults
--   2. UserPersonalityConfig (with llmConfigId) → UserPersonalityConfig.config_overrides
--   3. User (with defaultLlmConfigId) → User.config_defaults
--
-- Default values (skipped, no need to migrate):
--   maxMessages = 50, maxAge = NULL, maxImages = 10,
--   memoryScoreThreshold = 0.50, memoryLimit = 20
--
-- Merge semantics: existing cascade values (if any) take precedence over LlmConfig values.
-- This is a data-preserving migration — copies values, doesn't delete anything.

-- ============================================================================
-- Tier 1: Personality defaults (PersonalityDefaultConfig → Personality)
-- ============================================================================
WITH personality_overrides AS (
  SELECT
    pdc.personality_id,
    jsonb_strip_nulls(jsonb_build_object(
      'maxMessages', CASE WHEN lc.max_messages != 50 THEN lc.max_messages END,
      'maxAge', CASE WHEN lc.max_age IS NOT NULL THEN lc.max_age END,
      'maxImages', CASE WHEN lc.max_images != 10 THEN lc.max_images END,
      'memoryScoreThreshold', CASE WHEN lc.memory_score_threshold IS NOT NULL AND lc.memory_score_threshold != 0.50 THEN lc.memory_score_threshold::float8 END,
      'memoryLimit', CASE WHEN lc.memory_limit IS NOT NULL AND lc.memory_limit != 20 THEN lc.memory_limit END
    )) AS overrides
  FROM personality_default_configs pdc
  JOIN llm_configs lc ON pdc.llm_config_id = lc.id
)
UPDATE personalities p
SET
  config_defaults = CASE
    WHEN p.config_defaults IS NULL THEN po.overrides
    ELSE po.overrides || p.config_defaults
  END,
  updated_at = NOW()
FROM personality_overrides po
WHERE po.personality_id = p.id
  AND po.overrides != '{}'::jsonb;

-- ============================================================================
-- Tier 2: User-personality overrides (UserPersonalityConfig → self)
-- ============================================================================
WITH upc_overrides AS (
  SELECT
    upc.id AS upc_id,
    jsonb_strip_nulls(jsonb_build_object(
      'maxMessages', CASE WHEN lc.max_messages != 50 THEN lc.max_messages END,
      'maxAge', CASE WHEN lc.max_age IS NOT NULL THEN lc.max_age END,
      'maxImages', CASE WHEN lc.max_images != 10 THEN lc.max_images END,
      'memoryScoreThreshold', CASE WHEN lc.memory_score_threshold IS NOT NULL AND lc.memory_score_threshold != 0.50 THEN lc.memory_score_threshold::float8 END,
      'memoryLimit', CASE WHEN lc.memory_limit IS NOT NULL AND lc.memory_limit != 20 THEN lc.memory_limit END
    )) AS overrides
  FROM user_personality_configs upc
  JOIN llm_configs lc ON upc.llm_config_id = lc.id
  WHERE upc.llm_config_id IS NOT NULL
)
UPDATE user_personality_configs upc
SET
  config_overrides = CASE
    WHEN upc.config_overrides IS NULL THEN uo.overrides
    ELSE uo.overrides || upc.config_overrides
  END,
  updated_at = NOW()
FROM upc_overrides uo
WHERE uo.upc_id = upc.id
  AND uo.overrides != '{}'::jsonb;

-- ============================================================================
-- Tier 3: User defaults (User.defaultLlmConfigId → User.config_defaults)
-- ============================================================================
WITH user_overrides AS (
  SELECT
    u.id AS user_id,
    jsonb_strip_nulls(jsonb_build_object(
      'maxMessages', CASE WHEN lc.max_messages != 50 THEN lc.max_messages END,
      'maxAge', CASE WHEN lc.max_age IS NOT NULL THEN lc.max_age END,
      'maxImages', CASE WHEN lc.max_images != 10 THEN lc.max_images END,
      'memoryScoreThreshold', CASE WHEN lc.memory_score_threshold IS NOT NULL AND lc.memory_score_threshold != 0.50 THEN lc.memory_score_threshold::float8 END,
      'memoryLimit', CASE WHEN lc.memory_limit IS NOT NULL AND lc.memory_limit != 20 THEN lc.memory_limit END
    )) AS overrides
  FROM users u
  JOIN llm_configs lc ON u.default_llm_config_id = lc.id
  WHERE u.default_llm_config_id IS NOT NULL
)
UPDATE users u
SET
  config_defaults = CASE
    WHEN u.config_defaults IS NULL THEN uo.overrides
    ELSE uo.overrides || u.config_defaults
  END,
  updated_at = NOW()
FROM user_overrides uo
WHERE uo.user_id = u.id
  AND uo.overrides != '{}'::jsonb;
