-- Staff schedules and temporary operation grants. Updates use optimistic revisions.
CREATE TABLE staff_roster (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  mutation_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO staff_roster (id, state_json) VALUES (1, '{"settings":{"dailyHours":8,"maxDays":5,"maxConsecutive":5,"minStaff":1},"employees":[],"published":[],"drafts":{},"requests":[],"overrides":{},"assignments":{}}');
CREATE INDEX IF NOT EXISTS idx_audit_roster ON audit_logs(target_type, created_at);
