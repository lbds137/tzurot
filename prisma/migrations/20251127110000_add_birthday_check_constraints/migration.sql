-- AddCheckConstraints
-- Ensure birthday fields contain valid date components

-- birth_month must be 1-12 (or NULL)
ALTER TABLE "personalities"
  ADD CONSTRAINT "valid_birth_month" CHECK ("birth_month" IS NULL OR ("birth_month" >= 1 AND "birth_month" <= 12));

-- birth_day must be 1-31 (or NULL)
-- Note: Does not validate against specific month (e.g., Feb 30 allowed) - use application logic for strict validation
ALTER TABLE "personalities"
  ADD CONSTRAINT "valid_birth_day" CHECK ("birth_day" IS NULL OR ("birth_day" >= 1 AND "birth_day" <= 31));

-- birth_year must be reasonable (1-9999 or NULL) - prevents negative years and overflow
ALTER TABLE "personalities"
  ADD CONSTRAINT "valid_birth_year" CHECK ("birth_year" IS NULL OR ("birth_year" >= 1 AND "birth_year" <= 9999));
