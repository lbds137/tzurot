-- AddCheckConstraint
-- Belt-and-suspenders: defend against unrecognized provider strings landing
-- in users.default_stt_provider_id via out-of-band SQL writes (manual psql,
-- admin scripts, future migrations). Application-side narrowing via
-- isSttProvider() already handles unknown values at every read site, but a
-- DB-level check fails fast at the write boundary.

ALTER TABLE "users"
  ADD CONSTRAINT "valid_default_stt_provider_id"
  CHECK ("default_stt_provider_id" IS NULL OR "default_stt_provider_id" IN ('mistral', 'elevenlabs', 'voice-engine'));
