-- Reviewed additive patch for an existing baseline, NOT a bootstrap migration.
-- Apply only after baseline schema inspection, backup and explicit deployment approval.
ALTER TABLE "Tenant" ADD COLUMN "agentProcessingEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AgentEvent"
  ADD COLUMN "processingAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastProcessingReason" TEXT,
  ADD COLUMN "processingFailedAt" TIMESTAMP(3);
CREATE INDEX "AgentEvent_tenantId_consumedAt_processingFailedAt_nextAttemptAt_idx"
  ON "AgentEvent" ("tenantId", "consumedAt", "processingFailedAt", "nextAttemptAt");
