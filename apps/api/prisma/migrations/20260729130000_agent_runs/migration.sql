-- Per-agent execution telemetry.
--
-- Without this the agent fleet is unobservable: an agent degrading silently
-- looks exactly like one working, and there is no way to answer "which agent is
-- slow" or "why did that run stop". Backs the Automation and AI Performance
-- dashboards.

CREATE TABLE "agent_runs" (
    "id"          TEXT NOT NULL,
    "org_id"      TEXT NOT NULL,
    "run_id"      TEXT,
    "agent"       TEXT NOT NULL,
    "status"      TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "attempts"    INTEGER NOT NULL DEFAULT 1,
    "error"       TEXT,
    "notes"       JSONB NOT NULL DEFAULT '[]',
    "started_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- Dashboard queries are "recent activity for this org" and "failure rate per
-- agent"; both would be scans without these.
CREATE INDEX "agent_runs_org_id_started_at_idx" ON "agent_runs"("org_id", "started_at");
CREATE INDEX "agent_runs_org_id_agent_status_idx" ON "agent_runs"("org_id", "agent", "status");

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
