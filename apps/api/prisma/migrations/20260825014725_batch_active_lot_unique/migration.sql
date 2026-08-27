-- A lot number identifies a batch only while it is active: a deactivated batch
-- must not block reusing its number, which a plain unique constraint would.
CREATE UNIQUE INDEX "ReagentBatch_reagentId_lotNumber_active_key"
  ON "ReagentBatch" ("reagentId", "lotNumber")
  WHERE "active";
