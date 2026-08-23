// lib/audit/log.ts — the audit trail. Every event from every layer (circuit
// breaker, diagnosis, decision, each of the 13 compliance rules, promise-tracker
// transitions, execution outcomes, Claude API calls) writes one row here.
//
// Design note: rule functions in lib/rules/*.ts are pure — they take a fully
// built CustomerContext and return a result synchronously, they never do I/O
// themselves (see lib/rules/gate.ts for why). To make that possible while still
// letting rules see "what's already happened to this customer earlier in this
// same batch run" (e.g. did we already charge this mandate today, during this
// run), every logged event is mirrored into an in-memory array that's queried
// synchronously when building a CustomerContext, in addition to being persisted
// to Supabase (async, for the dashboard / case-detail UI to read afterward).
import { getSupabaseClient } from "@/lib/supabase/client";

// Shared event_type string constants for the events multiple layers need to
// query back out of the audit log (compliance-context building, dashboards).
// Using these instead of ad-hoc string literals keeps writers and readers in sync.
export const AUDIT_EVENT_TYPES = {
  CONTACT_ATTEMPT: "contact_attempt",
  CHARGE_ATTEMPT: "charge_attempt",
  PRE_DEBIT_NOTICE_SENT: "pre_debit_notice_sent",
} as const;

export type AuditLayer =
  | "circuit_breaker"
  | "diagnosis"
  | "decision"
  | "compliance"
  | "promise_tracker"
  | "execution"
  | "claude";

export type AuditEventInput = {
  case_id: string | null; // null for batch-wide events, e.g. a circuit breaker trip
  customer_id?: string | null;
  mandate_id?: string | null;
  channel?: string | null; // "whatsapp" | "sms" | "email" | "voice" | null
  layer: AuditLayer;
  event_type: string;
  detail?: Record<string, unknown>;
  reasoning_text?: string | null;
  /** Override the event timestamp — used when replaying a synthetic batch so
   * audit rows carry the seed data's timestamps rather than wall-clock "now". */
  timestamp?: Date;
};

export type AuditRow = {
  id: string;
  case_id: string | null;
  customer_id: string | null;
  mandate_id: string | null;
  channel: string | null;
  timestamp: string; // ISO
  layer: AuditLayer;
  event_type: string;
  detail_json: Record<string, unknown>;
  reasoning_text: string | null;
};

let seq = 0;
const memoryLog: AuditRow[] = [];

function nextId(): string {
  seq += 1;
  return `audit_${Date.now()}_${seq}`;
}

export async function logAuditEvent(input: AuditEventInput): Promise<AuditRow> {
  const row: AuditRow = {
    id: nextId(),
    case_id: input.case_id,
    customer_id: input.customer_id ?? null,
    mandate_id: input.mandate_id ?? null,
    channel: input.channel ?? null,
    timestamp: (input.timestamp ?? new Date()).toISOString(),
    layer: input.layer,
    event_type: input.event_type,
    detail_json: input.detail ?? {},
    reasoning_text: input.reasoning_text ?? null,
  };
  memoryLog.push(row);

  const client = getSupabaseClient();
  if (client) {
    const { error } = await client.from("audit_log").insert({
      id: row.id,
      case_id: row.case_id,
      customer_id: row.customer_id,
      mandate_id: row.mandate_id,
      channel: row.channel,
      timestamp: row.timestamp,
      layer: row.layer,
      event_type: row.event_type,
      detail_json: row.detail_json,
      reasoning_text: row.reasoning_text,
    });
    if (error) {
      console.error("[audit] failed to persist audit_log row to Supabase", error.message, row.id);
    }
  }
  return row;
}

export type AuditLogFilter = {
  customer_id?: string;
  mandate_id?: string;
  layer?: AuditLayer;
  event_types?: string[];
  channel?: string;
  since?: Date;
  until?: Date;
};

/** Synchronous query over the in-process audit log mirror. Used by rule-context
 * builders (compliance rules must stay pure/synchronous — see file header). */
export function queryAuditLogSync(filter: AuditLogFilter): AuditRow[] {
  return memoryLog.filter((row) => {
    if (filter.customer_id && row.customer_id !== filter.customer_id) return false;
    if (filter.mandate_id && row.mandate_id !== filter.mandate_id) return false;
    if (filter.layer && row.layer !== filter.layer) return false;
    if (filter.channel && row.channel !== filter.channel) return false;
    if (filter.event_types && !filter.event_types.includes(row.event_type)) return false;
    const t = new Date(row.timestamp).getTime();
    if (filter.since && t < filter.since.getTime()) return false;
    if (filter.until && t > filter.until.getTime()) return false;
    return true;
  });
}

/** Full in-memory log, for building batch-level reports (e.g. rule fire counts)
 * without a round trip to Supabase. */
export function getAllAuditRowsSync(): AuditRow[] {
  return memoryLog.slice();
}

export function resetAuditLogForTests(): void {
  memoryLog.length = 0;
  seq = 0;
}
