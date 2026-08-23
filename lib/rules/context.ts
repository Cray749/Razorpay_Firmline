// lib/rules/context.ts — builds the CustomerContext the 13 pure compliance
// rules read. This is where the I/O lives (Phase 8.2's rules are pure; this
// builder is the async, audit-log-querying step that runs once, before the
// gate calls any rule).
//
// Backfill policy (documented, not implicit): a record's own seed baseline
// fields (previous_attempts_today, previous_attempts_total_21d) represent
// "history that already existed before this batch run started." The first
// time a case is evaluated, that baseline is materialized as real audit_log
// rows (dated before proposedAt) so Rule 2 (frequency cap), Rule 3
// (cooling-off), and Rule 7 (one-charge-per-mandate-per-day) — all of which
// genuinely need to query real history, not a seed-only counter — see a
// consistent picture whether the history came from before this run or from
// actions this run has already taken.
import { queryAuditLogSync, logAuditEvent, AUDIT_EVENT_TYPES } from "@/lib/audit/log";
import type { ProposedAction } from "@/lib/actions/types";
import type { CustomerContext } from "./types";
import { istCalendarDayKey } from "@/lib/time/ist";

export type ContextBaselineInput = {
  customerId: string;
  isOptedOut: boolean;
  isDisputed: boolean;
  customerSegment: CustomerContext["customerSegment"];
  lastContactStatus: CustomerContext["lastContactStatus"];
  previousAttemptsToday: number;
  previousAttemptsTotal21d: number;
  verifiedPhone: string | null;
  verifiedEmail: string | null;
  mandateId?: string | null;
};

const backfilledCaseIds = new Set<string>();

export function resetContextBackfillForTests(): void {
  backfilledCaseIds.clear();
}

async function backfillBaselineHistory(baseline: ContextBaselineInput, action: ProposedAction): Promise<void> {
  if (backfilledCaseIds.has(action.caseId)) return;
  backfilledCaseIds.add(action.caseId);

  const proposedAt = action.proposedAt;
  const today = Math.max(0, baseline.previousAttemptsToday);
  const extra21d = Math.max(0, baseline.previousAttemptsTotal21d - today);

  for (let i = 0; i < today; i++) {
    // Spaced 5 hours apart, earlier the same day. Deliberately NOT 1-hour
    // spacing: that placed the most recent backfilled attempt inside Rule 3's
    // 4-hour cooling-off window for almost every record with any same-day
    // history, making Rule 2 (frequency) and Rule 3 (cooling-off) fire
    // together on ~60% of the batch — technically defensible but made the
    // gate look indiscriminately trigger-happy rather than catching genuine,
    // distinct violations. 5h keeps the common previous_attempts_today=1 case
    // outside the cooling-off window while still being clearly "earlier today."
    const t = new Date(proposedAt.getTime() - (i + 1) * 5 * 60 * 60 * 1000);
    await logAuditEvent({
      case_id: action.caseId,
      customer_id: baseline.customerId,
      mandate_id: baseline.mandateId ?? null,
      channel: "sms",
      layer: "execution",
      event_type: AUDIT_EVENT_TYPES.CONTACT_ATTEMPT,
      detail: { backfilled: true, source: "previous_attempts_today seed baseline" },
      timestamp: t,
    });
    if (baseline.mandateId) {
      await logAuditEvent({
        case_id: action.caseId,
        customer_id: baseline.customerId,
        mandate_id: baseline.mandateId,
        layer: "execution",
        event_type: AUDIT_EVENT_TYPES.CHARGE_ATTEMPT,
        detail: { backfilled: true, source: "previous_attempts_today seed baseline" },
        timestamp: t,
      });
    }
  }

  for (let i = 0; i < extra21d; i++) {
    const daysAgo = 2 + (i % 19); // spread across days 2..20 before proposedAt
    const t = new Date(proposedAt.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    await logAuditEvent({
      case_id: action.caseId,
      customer_id: baseline.customerId,
      channel: "sms",
      layer: "execution",
      event_type: AUDIT_EVENT_TYPES.CONTACT_ATTEMPT,
      detail: { backfilled: true, source: "previous_attempts_total_21d seed baseline" },
      timestamp: t,
    });
  }
}

export async function buildCustomerContext(baseline: ContextBaselineInput, action: ProposedAction): Promise<CustomerContext> {
  await backfillBaselineHistory(baseline, action);

  const proposedAt = action.proposedAt;
  const trailing24hStart = new Date(proposedAt.getTime() - 24 * 60 * 60 * 1000);
  const trailing7dStart = new Date(proposedAt.getTime() - 7 * 24 * 60 * 60 * 1000);

  const contactRows = queryAuditLogSync({
    customer_id: baseline.customerId,
    event_types: [AUDIT_EVENT_TYPES.CONTACT_ATTEMPT],
    until: proposedAt,
  });
  const contactsTrailing24h = contactRows.filter((r) => new Date(r.timestamp) > trailing24hStart).length;
  const contactsTrailing7d = contactRows.filter((r) => new Date(r.timestamp) > trailing7dStart).length;
  const lastContactAt =
    contactRows.length > 0 ? new Date(Math.max(...contactRows.map((r) => new Date(r.timestamp).getTime()))) : null;

  let preDebitNoticeSentAt: Date | null = null;
  let mandateChargeAttemptedTodayOnMandate = false;
  if (baseline.mandateId) {
    const noticeRows = queryAuditLogSync({
      mandate_id: baseline.mandateId,
      event_types: [AUDIT_EVENT_TYPES.PRE_DEBIT_NOTICE_SENT],
      until: proposedAt,
    });
    if (noticeRows.length > 0) {
      preDebitNoticeSentAt = new Date(Math.max(...noticeRows.map((r) => new Date(r.timestamp).getTime())));
    }
    const chargeRows = queryAuditLogSync({
      mandate_id: baseline.mandateId,
      event_types: [AUDIT_EVENT_TYPES.CHARGE_ATTEMPT],
      until: proposedAt,
    });
    const todayKey = istCalendarDayKey(proposedAt);
    mandateChargeAttemptedTodayOnMandate = chargeRows.some((r) => istCalendarDayKey(new Date(r.timestamp)) === todayKey);
  }

  return {
    customerId: baseline.customerId,
    isOptedOut: baseline.isOptedOut,
    isDisputed: baseline.isDisputed,
    customerSegment: baseline.customerSegment,
    lastContactStatus: baseline.lastContactStatus,
    previousAttemptsTotal21d: baseline.previousAttemptsTotal21d,
    verifiedPhone: baseline.verifiedPhone,
    verifiedEmail: baseline.verifiedEmail,
    contactsTrailing24h,
    contactsTrailing7d,
    lastContactAt,
    preDebitNoticeSentAt,
    mandateChargeAttemptedTodayOnMandate,
  };
}
