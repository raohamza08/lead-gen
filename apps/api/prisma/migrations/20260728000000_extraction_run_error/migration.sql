-- Records why a FAILED extraction run failed (e.g. the lead-finder CLI being
-- unavailable after its retries). Nullable: successful runs leave it NULL.
ALTER TABLE "extraction_runs" ADD COLUMN "error" TEXT;
