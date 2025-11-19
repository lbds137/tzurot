-- Add PostgreSQL NOTIFY triggers for automatic cache invalidation
-- When personality-related tables change, send NOTIFY events that services can LISTEN for

-- Function to notify cache invalidation for specific personality
CREATE OR REPLACE FUNCTION notify_personality_cache_invalidation()
RETURNS TRIGGER AS $$
DECLARE
  personality_ids UUID[];
  pid UUID;
BEGIN
  -- Determine which personalities are affected based on the table
  IF TG_TABLE_NAME = 'personalities' THEN
    -- Direct personality change
    personality_ids := ARRAY[COALESCE(NEW.id, OLD.id)];

  ELSIF TG_TABLE_NAME = 'llm_configs' THEN
    -- LLM config changed - find all personalities using this config
    SELECT ARRAY_AGG(DISTINCT pdc.personality_id)
    INTO personality_ids
    FROM personality_default_configs pdc
    WHERE pdc.llm_config_id = COALESCE(NEW.id, OLD.id);

    -- Also check user-specific configs
    SELECT ARRAY_AGG(DISTINCT upc.personality_id)
    INTO personality_ids
    FROM user_personality_configs upc
    WHERE upc.llm_config_id = COALESCE(NEW.id, OLD.id);

  ELSIF TG_TABLE_NAME = 'personality_default_configs' THEN
    -- Default config mapping changed
    personality_ids := ARRAY[COALESCE(NEW.personality_id, OLD.personality_id)];

  ELSIF TG_TABLE_NAME = 'user_personality_configs' THEN
    -- User-specific config changed
    personality_ids := ARRAY[COALESCE(NEW.personality_id, OLD.personality_id)];

  END IF;

  -- Send NOTIFY for each affected personality
  IF personality_ids IS NOT NULL THEN
    FOREACH pid IN ARRAY personality_ids
    LOOP
      IF pid IS NOT NULL THEN
        -- Send notification with personality ID as JSON payload
        PERFORM pg_notify(
          'cache_invalidation',
          json_build_object('type', 'personality', 'personalityId', pid::text)::text
        );
      END IF;
    END LOOP;
  END IF;

  RETURN NULL; -- AFTER trigger, return value doesn't matter
END;
$$ LANGUAGE plpgsql;

-- Add triggers to tables that affect personality configuration

-- Personalities table
DROP TRIGGER IF EXISTS trigger_personality_cache_invalidation ON personalities;
CREATE TRIGGER trigger_personality_cache_invalidation
  AFTER UPDATE ON personalities
  FOR EACH ROW
  WHEN (OLD.updated_at IS DISTINCT FROM NEW.updated_at)
  EXECUTE FUNCTION notify_personality_cache_invalidation();

-- LLM configs table
DROP TRIGGER IF EXISTS trigger_llm_config_cache_invalidation ON llm_configs;
CREATE TRIGGER trigger_llm_config_cache_invalidation
  AFTER UPDATE ON llm_configs
  FOR EACH ROW
  WHEN (OLD.updated_at IS DISTINCT FROM NEW.updated_at)
  EXECUTE FUNCTION notify_personality_cache_invalidation();

-- Personality default configs table
DROP TRIGGER IF EXISTS trigger_personality_default_config_cache_invalidation ON personality_default_configs;
CREATE TRIGGER trigger_personality_default_config_cache_invalidation
  AFTER INSERT OR UPDATE OR DELETE ON personality_default_configs
  FOR EACH ROW
  EXECUTE FUNCTION notify_personality_cache_invalidation();

-- User personality configs table
DROP TRIGGER IF EXISTS trigger_user_personality_config_cache_invalidation ON user_personality_configs;
CREATE TRIGGER trigger_user_personality_config_cache_invalidation
  AFTER INSERT OR UPDATE OR DELETE ON user_personality_configs
  FOR EACH ROW
  EXECUTE FUNCTION notify_personality_cache_invalidation();

-- Comment explaining the system
COMMENT ON FUNCTION notify_personality_cache_invalidation() IS
  'Automatically sends cache invalidation notifications when personality configurations change. Services listen for these notifications and invalidate their in-memory caches.';
