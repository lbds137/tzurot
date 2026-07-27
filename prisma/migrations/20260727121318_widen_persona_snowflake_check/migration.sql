-- Widen the bare-snowflake persona-name tripwire from 17-19 to 17-20 digits,
-- matching the canonical DISCORD_SNOWFLAKE.PATTERN (the u64 length ceiling).
-- With the app now accepting 20-digit ids, the old range let a 20-digit
-- bare-snowflake name through SILENTLY — the constraint exists to make that
-- class loud. Pre-verified: zero existing rows match '^\d{20}$' in dev/prod.
ALTER TABLE "personas" DROP CONSTRAINT "personas_name_not_snowflake";
ALTER TABLE "personas" ADD CONSTRAINT "personas_name_not_snowflake" CHECK ("name" !~ '^\d{17,20}$');
