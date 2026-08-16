-- Data-only migration (no schema change): retire the `show_thinking` key from
-- llm_configs.advanced_parameters. The display toggle it fed no longer exists;
-- extracted reasoning is carried as response metadata instead of rendered.
--
-- Safe in either order relative to the deploy: old code reading a stripped row
-- sees the key absent, which it already treats as falsy — the same behaviour it
-- had for every row that never set the key.
--
-- Raw SQL on purpose: no updated_at bump, so dev/prod last-write-wins sync
-- stays neutral (.claude/rules/03-database.md § Sync-Tracked Tables).

UPDATE llm_configs
SET advanced_parameters = advanced_parameters - 'show_thinking'
WHERE advanced_parameters ? 'show_thinking';
