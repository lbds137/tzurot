-- Optimize cache invalidation for llm_config changes
-- Instead of sending 100+ individual NOTIFY events (one per personality),
-- send a single "invalidate all" event when llm_configs change

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
    -- When llm_configs change, send single "all" event instead of N individual events
    -- This prevents notification storms when bulk operations occur
    PERFORM pg_notify(
      'cache_invalidation',
      json_build_object('type', 'all')::text
    );
    RETURN NULL; -- Exit early - already sent notification

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
