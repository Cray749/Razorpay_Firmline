// lib/metrics/resolution-simulation.ts — BUILD_MANUAL.md Phase 11's
// "resolution simulation, specified explicitly, not vague." For each
// executed (gate-allowed, tone-check-passed) action, this table defines a
// fixed success probability keyed by (action type, root cause). A seeded
// random number, deterministic per case_id, is rolled against it to mark the
// case resolved or not. This is explicitly a MODELED outcome on synthetic
// data, not a real payment result — the dashboard says so next to every
// number derived from it.
//
// ESCALATE_TO_HUMAN is never simulated as resolved/unresolved — a human
// takes over, and Firmline doesn't get to claim credit either way.
// NO_ACTION_NEEDED and STOP_AND_WRITE_OFF are excluded for the same reason
// (nothing to resolve, or explicitly written off).
import { createRng } from "@/data/seed/rng";
import type { ActionType } from "@/lib/actions/types";

export const RESOLUTION_PROBABILITY: Partial<Record<`${ActionType}:${string}`, number>> = {
  "SCHEDULE_COMPLIANT_RETRY:INSUFFICIENT_BALANCE": 0.65,
  "SCHEDULE_COMPLIANT_RETRY:MANDATE_TIMING_VIOLATION": 0.55,
  "SEND_SOFT_REMINDER:INSUFFICIENT_BALANCE": 0.3,
  "SEND_SOFT_REMINDER:INCORRECT_CREDENTIALS": 0.4,
  "SEND_SOFT_REMINDER:OVERSIGHT": 0.5,
  "SEND_SOFT_REMINDER:TRUST_SIGNAL_GAP": 0.25,
  "SEND_SOFT_REMINDER:PAYMENT_METHOD_FRICTION": 0.35,
  "SEND_PRE_DEBIT_NOTICE_THEN_RETRY:INSUFFICIENT_BALANCE": 0.5,
  "SEND_PRE_DEBIT_NOTICE_THEN_RETRY:MANDATE_TIMING_VIOLATION": 0.5,
  "OFFER_APPROVED_DISCOUNT:PRICE_SENSITIVITY": 0.7,
  "REQUEST_NEW_PAYMENT_METHOD:MANDATE_EXPIRED_OR_REVOKED": 0.45,
  "REQUEST_NEW_PAYMENT_METHOD:CARD_EXPIRED": 0.45,
  "GENERATE_PAYMENT_LINK:TECHNICAL_ERROR": 0.55,
  "GENERATE_PAYMENT_LINK:PAYMENT_METHOD_FRICTION": 0.5,
  "OFFER_PAYMENT_PLAN:CASH_FLOW_DELAY": 0.6,
  "CAPTURE_PROMISE_TO_PAY:CASH_FLOW_DELAY": 0.5,
  "CAPTURE_PROMISE_TO_PAY:APPROVAL_CHAIN_DELAY": 0.6,
  "SILENT_RETRY_LATER:RAIL_OUTAGE": 0.4,
  "SILENT_RETRY_LATER:GATEWAY_TECHNICAL_ERROR": 0.35,
};

const DEFAULT_PROBABILITY = 0.3; // any (action, cause) pair not listed above
const NOT_SIMULATED: ActionType[] = ["ESCALATE_TO_HUMAN", "NO_ACTION_NEEDED", "STOP_AND_WRITE_OFF"];

export function isSimulatable(actionType: ActionType): boolean {
  return !NOT_SIMULATED.includes(actionType);
}

function hashToSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic per-case-per-action resolution roll: same case_id + action
 * type always resolves the same way on repeat dashboard computations. */
export function rollResolved(caseId: string, actionType: ActionType, rootCause: string): boolean {
  const probability = RESOLUTION_PROBABILITY[`${actionType}:${rootCause}`] ?? DEFAULT_PROBABILITY;
  const rng = createRng(hashToSeed(`${caseId}:${actionType}:${rootCause}`));
  return rng.bool(probability);
}
