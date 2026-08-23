-- supabase/schema.sql — Firmline's Postgres schema. Run this once against a
-- fresh Supabase project (SQL Editor -> paste -> Run) before `npm run seed`.
--
-- This is a single, public demo instance with no login and no real user
-- data (BUILD_MANUAL.md section 2: "No login system, no multi-tenant
-- accounts, no billing"), so Row Level Security is deliberately left off —
-- there is no per-user data to isolate. See docs/architecture.md for the
-- reasoning.

-- ── Raw seed data ────────────────────────────────────────────────────────

create table if not exists payment_failures (
  id text primary key,
  customer_id text not null,
  customer_name text not null,
  customer_phone text not null,
  customer_email text not null,
  preferred_language text not null,
  amount_inr numeric not null,
  mandate_id text not null,
  mandate_max_amount_inr numeric not null,
  mandate_expiry timestamptz not null,
  failure_code text not null,
  attempted_at timestamptz not null,
  previous_attempts_today integer not null,
  previous_attempts_total_21d integer not null,
  is_opted_out boolean not null,
  is_disputed boolean not null,
  last_contact_status text not null,
  customer_segment text not null,
  true_root_cause text not null
);

create table if not exists checkout_abandonments (
  id text primary key,
  customer_id text not null,
  customer_name text not null,
  customer_phone text not null,
  customer_email text not null,
  preferred_language text not null,
  cart_value_inr numeric not null,
  time_on_payment_page_sec integer not null,
  sessions_count integer not null,
  payment_method_attempted text,
  abandoned_at timestamptz not null,
  is_opted_out boolean not null,
  customer_segment text not null,
  true_root_cause text not null
);

create table if not exists b2b_receivables (
  id text primary key,
  business_name text not null,
  contact_name text not null,
  contact_phone text not null,
  contact_email text not null,
  preferred_language text not null,
  invoice_amount_inr numeric not null,
  invoice_due_date date not null,
  days_overdue integer not null,
  payment_history_pattern text not null,
  dispute_flag boolean not null,
  is_opted_out boolean not null,
  true_root_cause text not null
);

-- ── Audit trail ──────────────────────────────────────────────────────────
-- Every event from every layer (circuit breaker, diagnosis, decision, each
-- of the 13 compliance rules, promise-tracker transitions, execution
-- outcomes, Claude API calls) writes one row here.

create table if not exists audit_log (
  id text primary key,
  case_id text,
  customer_id text,
  mandate_id text,
  channel text,
  timestamp timestamptz not null,
  layer text not null,
  event_type text not null,
  detail_json jsonb not null default '{}'::jsonb,
  reasoning_text text
);

create index if not exists audit_log_case_id_idx on audit_log (case_id);
create index if not exists audit_log_customer_id_idx on audit_log (customer_id);
create index if not exists audit_log_event_type_idx on audit_log (event_type);
create index if not exists audit_log_layer_idx on audit_log (layer);

-- ── Batch case results ───────────────────────────────────────────────────
-- One row per case per batch run — the real (compliance-gated) outcome and
-- the counterfactual naive-agent outcome, side by side, for fast dashboard
-- and counterfactual-view queries without re-deriving everything from
-- audit_log on every page load. Cleared and rewritten on every /api/batch run.

create table if not exists case_results (
  case_id text primary key,
  batch_run_id text not null,
  customer_id text not null,
  record_type text not null,
  root_cause text not null,
  diagnosis_confidence numeric not null,
  diagnosis_source text not null,
  needs_human_review boolean not null default false,
  paused_by_circuit_breaker boolean not null default false,
  actions_json jsonb not null default '[]'::jsonb,
  naive_actions_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists case_results_batch_run_id_idx on case_results (batch_run_id);
create index if not exists case_results_record_type_idx on case_results (record_type);
