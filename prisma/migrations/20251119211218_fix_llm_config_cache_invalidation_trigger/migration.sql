-- Fix llm_config trigger to invalidate ALL personalities
-- (personalities use is_default flag, not personality_default_configs table)

DROP FUNCTION IF EXISTS notify_personality_cache_invalidation() CASCADE;

CREATE OR REPLACE FUNCTION notify_personality_cache_invalidation()
RETURNS TRIGGER AS $$
DECLARE
  personality_ids UUID[];
  pid UUID;
BEGIN
  -- Determine which personalities are affected based on the table
  IF TG_TABLE_NAME = 'personalities' THEN
    personality_ids := ARRAY[COALESCE(NEW.id, OLD.id)];

  ELSIF TG_TABLE_NAME = 'llm_configs' THEN
    -- When llm_configs change, ALL personalities may be affected
    -- (they use the is_default flag to find their config)
    -- So invalidate all personality caches
    SELECT ARRAY_AGG(id)
    INTO personality_ids
    FROM personalities;

  ELSIF TG_TABLE_NAME = 'personality_default_configs' THEN
    personality_ids := ARRAY[COALESCE(NEW.personality_id, OLD.personality_id)];

  ELSIF TG_TABLE_NAME = 'user_personality_configs' THEN
    personality_ids := ARRAY[COALESCE(NEW.personality_id, OLD.personality_id)];
  END IF;

  -- Send NOTIFY for each affected personality
  IF personality_ids IS NOT NULL THEN
    FOREACH pid IN ARRAY personality_ids
    LOOP
      IF pid IS NOT NULL THEN
        PERFORM pg_notify(
          'cache_invalidation',
          json_build_object('type', 'personality', 'personalityId', pid::text)::text
        );
      END IF;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Recreate all triggers (they reference the function)
DROP TRIGGER IF EXISTS trigger_personality_cache_invalidation ON personalities;
CREATE TRIGGER trigger_personality_cache_invalidation
  AFTER UPDATE ON personalities
  FOR EACH ROW
  WHEN (OLD.updated_at IS DISTINCT FROM NEW.updated_at)
  EXECUTE FUNCTION notify_personality_cache_invalidation();

DROP TRIGGER IF EXISTS trigger_llm_config_cache_invalidation ON llm_configs;
CREATE TRIGGER trigger_llm_config_cache_invalidation
  AFTER UPDATE ON llm_configs
  FOR EACH ROW
  WHEN (OLD.updated_at IS DISTINCT FROM NEW.updated_at)
  EXECUTE FUNCTION notify_personality_cache_invalidation();

DROP TRIGGER IF EXISTS trigger_personality_default_config_cache_invalidation ON personality_default_configs;
CREATE TRIGGER trigger_personality_default_config_cache_invalidation
  AFTER INSERT OR UPDATE OR DELETE ON personality_default_configs
  FOR EACH ROW
  EXECUTE FUNCTION notify_personality_cache_invalidation();

DROP TRIGGER IF EXISTS trigger_user_personality_config_cache_invalidation ON user_personality_configs;
CREATE TRIGGER trigger_user_personality_config_cache_invalidation
  AFTER INSERT OR UPDATE OR DELETE ON user_personality_configs
  FOR EACH ROW
  EXECUTE FUNCTION notify_personality_cache_invalidation();
