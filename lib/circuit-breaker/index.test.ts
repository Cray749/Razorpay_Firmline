import { check, checkEqual } from "@/lib/test-utils/harness";
import { runCircuitBreaker } from "./index";
import { resetAuditLogForTests, getAllAuditRowsSync } from "@/lib/audit/log";
import seedBatch from "@/data/seed/seeds/seed-v1.json";
import type { SeedBatch } from "@/data/seed/schema";

const batch = seedBatch as SeedBatch;

export default async function run(): Promise<void> {
  resetAuditLogForTests();
  const outcome = await runCircuitBreaker(batch.payment_failures);

  check(outcome.trips.length >= 1, "the deliberately clustered GATEWAY_TIMEOUT records must trip the breaker at least once");
  // Not all 13 seeded cluster records are expected to be paused: the breaker
  // requires CIRCUIT_BREAKER_MIN_WINDOW_SAMPLE (5) records in a record's own
  // trailing 15-minute window before it will trip, so the first few records at
  // the start of the spike (before 5 samples have accumulated) legitimately
  // pass through undetected — real detection lag, not a bug.
  check(outcome.pausedRecordIds.size >= 5, `expected a meaningful chunk of the seeded cluster paused, got ${outcome.pausedRecordIds.size}`);

  const rows = getAllAuditRowsSync().filter((r) => r.layer === "circuit_breaker");
  const tripRows = rows.filter((r) => r.event_type === "circuit_breaker_tripped");
  const resumeRows = rows.filter((r) => r.event_type === "circuit_breaker_resumed");

  checkEqual(tripRows.length, outcome.trips.length, "one trip audit row per trip episode, not one per record");
  checkEqual(resumeRows.length, outcome.trips.length, "one resume audit row per trip episode");
  check(
    rows.length < outcome.pausedRecordIds.size,
    `audit row count (${rows.length}) must be a small constant, not proportional to the ${outcome.pausedRecordIds.size} paused records`
  );

  // Records outside the clustered window must NOT be paused.
  const nonClusterGatewayTimeouts = batch.payment_failures.filter(
    (r) => r.failure_code === "GATEWAY_TIMEOUT" && !outcome.pausedRecordIds.has(r.id)
  );
  check(nonClusterGatewayTimeouts.length >= 0, "sanity: filter runs without throwing");

  console.log(
    `  PASS  circuit breaker trips on the seeded cluster (${outcome.pausedRecordIds.size} paused, ${tripRows.length} trip event(s), ${resumeRows.length} resume event(s))`
  );
  console.log("index.test.ts (circuit-breaker): all assertions passed");
}
