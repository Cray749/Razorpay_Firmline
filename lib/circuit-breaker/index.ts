// lib/circuit-breaker/index.ts — batch-wide, stateful. Deliberately NOT compliance
// Rule 14: it watches the payment-failure stream BEFORE individual records are
// even diagnosed, sitting architecturally upstream of Diagnosis, not alongside
// the (stateless, per-record) compliance rules.
//
// Logic: walk payment failures in chronological order (by attempted_at, not
// wall-clock — this runs against a batch of historical synthetic data). For
// each record, look at the rolling 15-minute window of records ending at that
// record's timestamp. If more than 15% of that window is GATEWAY_TIMEOUT,
// the breaker is tripped for as long as that condition holds. While tripped,
// affected records are paused (never reach Diagnosis/Decision/Compliance/
// Execution as individuals) and exactly ONE audit event describes the whole
// suspended episode; resuming produces exactly one more audit event. This is
// deliberate: a spike of rail-timeout failures is very likely one systemic
// outage, not N independent customer-fault events, so N individually-reasoned
// log entries would be noise, not honesty.
import type { PaymentFailure } from "@/data/seed/schema";
import { logAuditEvent } from "@/lib/audit/log";

export const CIRCUIT_BREAKER_WINDOW_MS = 15 * 60 * 1000;
export const CIRCUIT_BREAKER_THRESHOLD = 0.15;
// A minimum sample size before the rate is evaluated at all — without this, a
// single isolated GATEWAY_TIMEOUT with no neighbors in its window is "100% of
// window" and incorrectly trips the breaker on ordinary, unrelated noise. Real
// evidence of a systemic rail outage looks like a cluster, not one data point.
export const CIRCUIT_BREAKER_MIN_WINDOW_SAMPLE = 5;

export type CircuitBreakerOutcome = {
  pausedRecordIds: Set<string>;
  trips: Array<{ windowStart: string; windowEnd: string; affectedCount: number }>;
};

export async function runCircuitBreaker(records: PaymentFailure[]): Promise<CircuitBreakerOutcome> {
  const sorted = [...records].sort(
    (a, b) => new Date(a.attempted_at).getTime() - new Date(b.attempted_at).getTime()
  );

  const paused = new Set<string>();
  const trips: CircuitBreakerOutcome["trips"] = [];

  let tripped = false;
  let episode: PaymentFailure[] = [];

  const closeEpisode = async () => {
    if (episode.length === 0) return;
    const windowStart = episode[0].attempted_at;
    const windowEnd = episode[episode.length - 1].attempted_at;
    trips.push({ windowStart, windowEnd, affectedCount: episode.length });
    await logAuditEvent({
      case_id: null,
      layer: "circuit_breaker",
      event_type: "circuit_breaker_tripped",
      reasoning_text: `Execution suspended: rail degradation detected, ${episode.length} records affected, window [${windowStart}, ${windowEnd}]`,
      detail: {
        affectedCount: episode.length,
        windowStart,
        windowEnd,
        affectedIds: episode.map((r) => r.id),
        threshold: CIRCUIT_BREAKER_THRESHOLD,
      },
    });
    await logAuditEvent({
      case_id: null,
      layer: "circuit_breaker",
      event_type: "circuit_breaker_resumed",
      reasoning_text: `Execution resumed: gateway-timeout rate normalized after window [${windowStart}, ${windowEnd}]`,
      detail: { afterAffectedCount: episode.length, windowStart, windowEnd },
    });
    episode = [];
  };

  for (const rec of sorted) {
    const t = new Date(rec.attempted_at).getTime();
    const windowRecords = sorted.filter((r) => {
      const rt = new Date(r.attempted_at).getTime();
      return rt <= t && rt > t - CIRCUIT_BREAKER_WINDOW_MS;
    });
    const timeoutCount = windowRecords.filter((r) => r.failure_code === "GATEWAY_TIMEOUT").length;
    const rate = windowRecords.length > 0 ? timeoutCount / windowRecords.length : 0;
    const shouldBeTripped = windowRecords.length >= CIRCUIT_BREAKER_MIN_WINDOW_SAMPLE && rate > CIRCUIT_BREAKER_THRESHOLD;

    if (shouldBeTripped && !tripped) {
      tripped = true;
      episode = [];
    }
    if (!shouldBeTripped && tripped) {
      tripped = false;
      await closeEpisode();
    }
    if (tripped) {
      paused.add(rec.id);
      episode.push(rec);
    }
  }
  if (tripped) {
    // Batch ended while still tripped — still just one closing audit event, not zero.
    await closeEpisode();
  }

  return { pausedRecordIds: paused, trips };
}
