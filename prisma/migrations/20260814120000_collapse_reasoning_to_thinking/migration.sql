-- Data-only migration (no schema change): collapse the retired 4-knob
-- `reasoning` object inside llm_configs.advanced_parameters into the one
-- canonical `thinking` level the application now reads.
--
-- ⚠️ APPLY THIS **AFTER** THE CODE IS DEPLOYED — the reverse of the standard
-- prod order in 03-database.md § Deployment. There is no DDL here, so
-- `release:premigrate`'s destructive-shape detector (DROP/RENAME COLUMN,
-- ALTER COLUMN TYPE …) reads this as additive and would apply it BEFORE the
-- release merges, while the old code is still live. But this is semantically a
-- key RENAME: code that predates the collapse knows only `reasoning`, so
-- against a migrated row its Zod parse strips the unknown `thinking`, finds no
-- `reasoning`, and behaves as though reasoning were never configured — no
-- scaled max_tokens, no effort sent upstream, leak detection off, for every
-- config that set one.
--
-- The opposite order is safe and needs no maintenance window: NEW code reads
-- an UN-migrated row correctly, because `safeValidateAdvancedParams` parses
-- through `AdvancedParamsInputSchema` and upgrades the legacy object on read.
-- So: deploy first, migrate second. Owner decision, recorded here because the
-- standing rule says the opposite and a future reader would follow it.
--
-- Precedence — the same LEVEL MAPPING `upgradeLegacyReasoningShape()` applies
-- to inbound payloads (packages/common-types/src/schemas/llmAdvancedParams.ts).
-- llmAdvancedParams.test.ts drives the TS half from a table matching the rows
-- below; the two are kept in step BY CONVENTION — no test or lint cross-checks
-- the SQL, so change them together:
--   enabled:false           -> 'off'   (explicit off wins over any effort)
--   effort:'none'           -> 'off'
--   effort:'xhigh'          -> 'max'
--   effort:high|medium|low|minimal -> same name
--   max_tokens only         -> 'high'  (a FIXED mapping, not proportional to
--                              the budget: the retired schema documented high
--                              as ~80% of max_tokens, so it is the level whose
--                              DOCUMENTED meaning matches a bare budget — a
--                              1024-token budget maps to 'high' too)
--   absent/empty/exclude-only      -> no `thinking` key at all
--
-- One deliberate divergence: when `reasoning` is not an object at all (a
-- string, an array, JSON null), the TS preprocessor passes the payload through
-- untouched, because it is a general-purpose boundary function that must not
-- mangle input it does not recognize. Pass 2 below drops such a key instead —
-- a one-shot cleanup should leave no junk behind. Expected to be unreachable —
-- the write paths in the current tree all validate through the old
-- ReasoningConfigSchema before persisting — but that is not verified against
-- the full history of the column, so both behaviours are defined rather than
-- assumed away.
--
-- A row that ends with no `thinking` key keeps taking the provider default,
-- which is exactly what a level-less `reasoning` object already meant.
--
-- Raw SQL on purpose: no updated_at bump, so dev/prod last-write-wins sync
-- stays neutral (.claude/rules/03-database.md § Sync-Tracked Tables). The
-- mapping is deterministic, so both environments converge on the same rows.

-- Pass 1 — rows whose `reasoning` object expresses a level.
UPDATE llm_configs
SET advanced_parameters =
  (advanced_parameters - 'reasoning')
  || jsonb_build_object(
       'thinking',
       CASE
         WHEN advanced_parameters->'reasoning'->>'enabled' = 'false' THEN 'off'
         WHEN advanced_parameters->'reasoning'->>'effort' = 'none'   THEN 'off'
         WHEN advanced_parameters->'reasoning'->>'effort' = 'xhigh'  THEN 'max'
         WHEN advanced_parameters->'reasoning'->>'effort'
              IN ('high', 'medium', 'low', 'minimal')
           THEN advanced_parameters->'reasoning'->>'effort'
         ELSE 'high'
       END
     )
WHERE advanced_parameters ? 'reasoning'
  -- A `thinking` key already holding a VALUE wins, matching
  -- upgradeLegacyReasoningShape's documented precedence. Without this the `||`
  -- merge above would overwrite it with the value derived from the stale
  -- `reasoning` object — the exact opposite. Such a row should not exist (every
  -- write path resolves the conflict before persisting), so this guard makes
  -- the two mappings agree unconditionally rather than by that argument. A
  -- both-keys row falls to pass 2, which drops `reasoning` and leaves
  -- `thinking` intact.
  --
  -- `->>` rather than `? 'thinking'` on purpose: `?` tests key EXISTENCE, so a
  -- key holding JSON null would count as present and strand `thinking: null` —
  -- which the enum rejects, failing validation for the whole params object on
  -- the next read. `->>` yields SQL NULL for both absent and JSON-null, which
  -- is exactly the TS side's "no level expressed" case.
  AND advanced_parameters->>'thinking' IS NULL
  AND (
       advanced_parameters->'reasoning'->>'enabled' = 'false'
    OR advanced_parameters->'reasoning'->>'effort'
         IN ('none', 'xhigh', 'high', 'medium', 'low', 'minimal')
    -- Typed, not merely non-null: the TS side requires `typeof === 'number'`,
    -- so a stray string budget must fall through to "no level" rather than
    -- landing in the ELSE arm above.
    OR jsonb_typeof(advanced_parameters->'reasoning'->'max_tokens') = 'number'
  );

-- Pass 2 — a surviving `reasoning` object expresses no level (empty,
-- `exclude`-only, `enabled:true` with no budget, or an effort value outside
-- the retired enum). Drop it; the row correctly ends with no `thinking` key.
-- Selecting these in pass 1 would write `"thinking": null`, which the new Zod
-- enum rejects.
UPDATE llm_configs
SET advanced_parameters = advanced_parameters - 'reasoning'
WHERE advanced_parameters ? 'reasoning';
