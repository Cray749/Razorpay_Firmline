// lib/rules/gate.ts — the aggregator. Runs all 13 rules against one proposed
// action, per BUILD_MANUAL.md 13.3. Two fast-path rules (opt-out, dispute
// freeze) are checked first and short-circuit everything else, since nothing
// downstream matters if either fires. The remaining rules run together.
// Rule 9 (tone/content) is intentionally NOT run here — it operates on
// generated message text, called a second time by Execution after message
// generation (see lib/rules/09-tone-content.ts's header comment).
//
// Every single call to this gate is logged — allowed and blocked alike —
// because "how often did the gate actually do something" is a headline metric.
import type { ProposedAction } from "@/lib/actions/types";
import type { CustomerContext, RuleResult } from "./types";
import { logAuditEvent } from "@/lib/audit/log";

import { checkOptOut } from "./04-opt-out";
import { checkDisputeFreeze } from "./13-dispute-freeze";
import { checkContactWindow } from "./01-contact-window";
import { checkFrequencyCap } from "./02-frequency-cap";
import { checkCoolingOff } from "./03-cooling-off";
import { checkVerifiedContact } from "./05-verified-contact";
import { checkPreDebitNotice } from "./06-pre-debit-notice";
import { checkOneChargePerDay } from "./07-one-charge-per-day";
import { checkNpciWindow } from "./08-npci-window";
import { checkDiscountFairness } from "./10-discount-fairness";
import { checkStopLoss } from "./11-stop-loss";
import { checkBounceSuppression } from "./12-bounce-suppression";

export type NamedRuleResult = RuleResult & { ruleId: string; ruleName: string };

export type GateResult = {
  allowed: boolean;
  blockedBy: NamedRuleResult[];
  allResults: NamedRuleResult[];
  /** Set when a blocking rule (currently only Rule 6) proposes a reschedule
   * rather than a flat rejection. */
  rescheduleTo?: Date;
};

const REMAINING_RULES: Array<{ id: string; name: string; fn: (a: ProposedAction, c: CustomerContext) => RuleResult }> = [
  { id: "01", name: "contact-window", fn: checkContactWindow },
  { id: "02", name: "frequency-cap", fn: checkFrequencyCap },
  { id: "03", name: "cooling-off", fn: checkCoolingOff },
  { id: "05", name: "verified-contact", fn: checkVerifiedContact },
  { id: "06", name: "pre-debit-notice", fn: checkPreDebitNotice },
  { id: "07", name: "one-charge-per-day", fn: checkOneChargePerDay },
  { id: "08", name: "npci-window", fn: checkNpciWindow },
  { id: "10", name: "discount-fairness", fn: checkDiscountFairness },
  { id: "11", name: "stop-loss", fn: checkStopLoss },
  { id: "12", name: "bounce-suppression", fn: checkBounceSuppression },
];

function toNamed(id: string, name: string, result: RuleResult): NamedRuleResult {
  return { ...result, ruleId: id, ruleName: name };
}

async function logRuleResult(action: ProposedAction, result: NamedRuleResult): Promise<void> {
  await logAuditEvent({
    case_id: action.caseId,
    customer_id: action.customerId,
    mandate_id: action.mandateId ?? null,
    layer: "compliance",
    event_type: `rule_${result.ruleId}_${result.ruleName}`,
    reasoning_text: result.reason,
    detail: { allowed: result.allowed, actionType: action.actionType, rescheduleTo: result.rescheduleTo?.toISOString() },
  });
}

export async function runComplianceGate(action: ProposedAction, context: CustomerContext): Promise<GateResult> {
  const optOut = toNamed("04", "opt-out", checkOptOut(action, context));
  await logRuleResult(action, optOut);
  if (!optOut.allowed) {
    return { allowed: false, blockedBy: [optOut], allResults: [optOut] };
  }

  const disputeFreeze = toNamed("13", "dispute-freeze", checkDisputeFreeze(action, context));
  await logRuleResult(action, disputeFreeze);
  if (!disputeFreeze.allowed) {
    return { allowed: false, blockedBy: [disputeFreeze], allResults: [optOut, disputeFreeze] };
  }

  const results = await Promise.all(
    REMAINING_RULES.map(async ({ id, name, fn }) => {
      const result = toNamed(id, name, fn(action, context));
      await logRuleResult(action, result);
      return result;
    })
  );

  const allResults = [optOut, disputeFreeze, ...results];
  const blockedBy = results.filter((r) => !r.allowed);
  const rescheduleTo = blockedBy.find((r) => r.rescheduleTo)?.rescheduleTo;

  return { allowed: blockedBy.length === 0, blockedBy, allResults, rescheduleTo };
}
