/** SQLite v2 additive schema: legacy tasks/artifacts/documents are never dropped or rewritten. */
export const FUSION_V2_TABLES = [
  'fusion_runs', 'fusion_session_aliases', 'fusion_branch_lineage', 'fusion_agents',
  'fusion_generations', 'fusion_assignments', 'fusion_dependencies', 'fusion_transitions',
  'fusion_checkpoints', 'fusion_effects', 'fusion_events', 'fusion_decisions',
  'fusion_usage', 'fusion_cache', 'fusion_budgets', 'fusion_evidence',
  'fusion_worktrees', 'fusion_model_scores',
] as const

export const FUSION_V2_SQL = `
CREATE TABLE fusion_runs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, current_host_session TEXT NOT NULL,
  status TEXT NOT NULL, mode TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE fusion_session_aliases (
  host_session_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES fusion_runs(id),
  selection_status TEXT NOT NULL, branch_id TEXT, fork_point_seq INTEGER,
  revision INTEGER NOT NULL CHECK (revision >= 0)
);
CREATE INDEX fusion_session_aliases_run ON fusion_session_aliases(run_id);
CREATE TABLE fusion_branch_lineage (
  branch_id TEXT PRIMARY KEY, parent_branch_id TEXT REFERENCES fusion_branch_lineage(branch_id),
  parent_run_id TEXT NOT NULL REFERENCES fusion_runs(id), fork_point_seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE fusion_agents (
  agent_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES fusion_runs(id),
  role TEXT NOT NULL, permission_profile TEXT NOT NULL, current_generation_id TEXT
);
CREATE INDEX fusion_agents_run ON fusion_agents(run_id);
CREATE TABLE fusion_generations (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES fusion_agents(agent_id),
  native_session_id TEXT NOT NULL, epoch INTEGER NOT NULL CHECK (epoch > 0),
  provider TEXT NOT NULL, model TEXT NOT NULL, capability_digest TEXT NOT NULL,
  status TEXT NOT NULL, UNIQUE(agent_id, epoch)
);
CREATE INDEX fusion_generations_agent_status ON fusion_generations(agent_id, status);
CREATE TABLE fusion_assignments (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES fusion_runs(id),
  brief_revision INTEGER NOT NULL, role TEXT NOT NULL, worker_id TEXT,
  status TEXT NOT NULL, write_scope_json TEXT NOT NULL
);
CREATE INDEX fusion_assignments_run_status ON fusion_assignments(run_id, status);
CREATE TABLE fusion_dependencies (
  assignment_id TEXT NOT NULL REFERENCES fusion_assignments(id),
  depends_on_id TEXT NOT NULL REFERENCES fusion_assignments(id),
  PRIMARY KEY (assignment_id, depends_on_id), CHECK (assignment_id <> depends_on_id)
);
CREATE INDEX fusion_dependencies_depends_on ON fusion_dependencies(depends_on_id);
CREATE TABLE fusion_transitions (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES fusion_runs(id),
  agent_id TEXT NOT NULL REFERENCES fusion_agents(agent_id),
  from_gen TEXT REFERENCES fusion_generations(id), to_gen TEXT REFERENCES fusion_generations(id),
  phase TEXT NOT NULL, expected_revision INTEGER NOT NULL, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX fusion_transitions_run_phase ON fusion_transitions(run_id, phase);
CREATE TABLE fusion_checkpoints (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES fusion_runs(id),
  agent_id TEXT NOT NULL REFERENCES fusion_agents(agent_id),
  generation_id TEXT REFERENCES fusion_generations(id), content_digest TEXT NOT NULL,
  artifact_ref TEXT, workspace_ref TEXT, schema_version INTEGER NOT NULL
);
CREATE INDEX fusion_checkpoints_run ON fusion_checkpoints(run_id);
CREATE TABLE fusion_effects (
  effect_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES fusion_runs(id),
  generation_id TEXT NOT NULL REFERENCES fusion_generations(id), tool_call_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL, state TEXT NOT NULL, receipt_ref TEXT,
  idempotency_key TEXT NOT NULL UNIQUE
);
CREATE INDEX fusion_effects_run_state ON fusion_effects(run_id, state);
CREATE TABLE fusion_events (
  event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES fusion_runs(id),
  seq INTEGER NOT NULL CHECK (seq > 0), type TEXT NOT NULL, payload_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL, timestamp INTEGER NOT NULL,
  UNIQUE(run_id, seq)
);
CREATE INDEX fusion_events_run_type ON fusion_events(run_id, type);
CREATE TABLE fusion_decisions (
  decision_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES fusion_runs(id),
  checkpoint TEXT NOT NULL, policy_version TEXT NOT NULL,
  candidates_json TEXT NOT NULL, selected_json TEXT NOT NULL, rationale_json TEXT NOT NULL
);
CREATE INDEX fusion_decisions_run ON fusion_decisions(run_id);
CREATE TABLE fusion_usage (
  provider_request_id TEXT NOT NULL, attempt INTEGER NOT NULL CHECK (attempt >= 0),
  run_id TEXT NOT NULL REFERENCES fusion_runs(id), agent_id TEXT REFERENCES fusion_agents(agent_id),
  generation_id TEXT REFERENCES fusion_generations(id), price_version TEXT,
  input_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
  output_tokens INTEGER, cost REAL, status TEXT NOT NULL,
  PRIMARY KEY(provider_request_id, attempt)
);
CREATE INDEX fusion_usage_run ON fusion_usage(run_id);
CREATE TABLE fusion_cache (
  run_id TEXT NOT NULL REFERENCES fusion_runs(id),
  generation_id TEXT NOT NULL REFERENCES fusion_generations(id),
  cache_key TEXT NOT NULL, saved_cost REAL NOT NULL, keepalive_cost REAL NOT NULL,
  expire_at INTEGER NOT NULL, policy_version TEXT NOT NULL,
  PRIMARY KEY(run_id, generation_id, cache_key)
);
CREATE TABLE fusion_budgets (
  budget_id TEXT PRIMARY KEY, hard_cost REAL, duration INTEGER, max_calls INTEGER,
  max_agents INTEGER, max_retries INTEGER, spent REAL NOT NULL DEFAULT 0,
  reserved REAL NOT NULL DEFAULT 0, approval_id TEXT
);
CREATE TABLE fusion_evidence (
  evidence_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES fusion_runs(id),
  requirement_id TEXT NOT NULL, source TEXT NOT NULL, command TEXT,
  exit_code INTEGER, artifact_digest TEXT, verdict TEXT NOT NULL, produced_at INTEGER NOT NULL
);
CREATE INDEX fusion_evidence_run_requirement ON fusion_evidence(run_id, requirement_id);
CREATE TABLE fusion_worktrees (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES fusion_runs(id),
  assignment_id TEXT REFERENCES fusion_assignments(id), base_commit TEXT NOT NULL,
  path TEXT NOT NULL, state TEXT NOT NULL, merge_commit TEXT, rollback_ref TEXT
);
CREATE INDEX fusion_worktrees_run ON fusion_worktrees(run_id);
CREATE TABLE fusion_model_scores (
  task_bucket TEXT NOT NULL, model_pair_key TEXT NOT NULL, policy_version TEXT NOT NULL,
  sample_n INTEGER NOT NULL DEFAULT 0, success_n INTEGER NOT NULL DEFAULT 0,
  cost_sum REAL NOT NULL DEFAULT 0, duration_sum REAL NOT NULL DEFAULT 0,
  failures_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(task_bucket, model_pair_key, policy_version)
);
`
