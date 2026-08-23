// lib/rules/09-tone-content.ts — RBI Fair Practices Code: no threatening,
// shaming, or legal-action language in a generated message.
//
// This rule deliberately does NOT match the ComplianceRule (action, context)
// signature the other 12 rules share: it runs on generated message TEXT,
// called a second time by Execution after message generation and before
// dispatch (BUILD_MANUAL.md 13.2/14.1), not once at the top of the gate
// alongside the others. If flagged, dispatch is blocked and the case is
// routed to human_review_queue — never auto-corrected and sent.
import type { RuleResult } from "./types";

const THREAT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /legal action/i, label: "legal action" },
  { pattern: /will be reported/i, label: "will be reported" },
  { pattern: /consequences/i, label: "consequences" },
  { pattern: /legal notice/i, label: "legal notice" },
  { pattern: /final notice/i, label: "final notice" },
  { pattern: /last warning/i, label: "last warning" },
  { pattern: /recovery agent/i, label: "recovery agent" },
  { pattern: /black[\s-]?list/i, label: "blacklist" },
  { pattern: /credit score (will|may) (be )?impact/i, label: "credit score threat" },
];

const SHAMING_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /everyone will know/i, label: "everyone will know" },
  { pattern: /embarrassing/i, label: "embarrassing" },
  { pattern: /shame on you/i, label: "shame on you" },
  { pattern: /your family will know/i, label: "your family will know" },
];

const MULTIPLE_EXCLAMATIONS = /!{2,}/;
const ALL_CAPS_RUN = /\b[A-Z]{5,}\b/; // a run of 5+ consecutive capital letters as a "word" — long enough to skip short real acronyms (UPI, RBI, IST)

export function checkToneContent(messageText: string): RuleResult {
  for (const { pattern, label } of THREAT_PATTERNS) {
    if (pattern.test(messageText)) {
      return {
        allowed: false,
        reason: `Message contains threat language ("${label}") — blocked from dispatch and routed to the human review queue, never auto-corrected and sent.`,
      };
    }
  }
  for (const { pattern, label } of SHAMING_PATTERNS) {
    if (pattern.test(messageText)) {
      return {
        allowed: false,
        reason: `Message contains shaming language ("${label}") — blocked from dispatch and routed to the human review queue.`,
      };
    }
  }
  if (MULTIPLE_EXCLAMATIONS.test(messageText)) {
    return {
      allowed: false,
      reason: "Message contains multiple consecutive exclamation marks — excessive urgency, blocked from dispatch and routed to the human review queue.",
    };
  }
  if (ALL_CAPS_RUN.test(messageText)) {
    return {
      allowed: false,
      reason: "Message contains an all-caps run — excessive urgency, blocked from dispatch and routed to the human review queue.",
    };
  }
  return { allowed: true, reason: "Message text passes the tone and content check." };
}

// Rule 9's signature (messageText -> RuleResult) doesn't fit the shared
// RuleTestCase (action, context) shape the other 12 rules use, so its test
// cases are a small parallel structure of the same spirit: one pass, several
// blocked (one per pattern category), and a boundary case.
export const messageTestCases: Array<{ name: string; messageText: string; expectAllowed: boolean; expectReasonContains?: string }> = [
  {
    name: "a plain compliant reminder passes",
    messageText: "Hi Aarav, your payment of Rs 999 didn't go through. You can retry anytime using this link: https://example.com/pay/abc123",
    expectAllowed: true,
  },
  {
    name: "threat language is blocked",
    messageText: "This is your final notice. Legal action will be taken if payment is not received.",
    expectAllowed: false,
    expectReasonContains: "threat language",
  },
  {
    name: "shaming language is blocked",
    messageText: "This is embarrassing — please pay your invoice.",
    expectAllowed: false,
    expectReasonContains: "shaming language",
  },
  {
    name: "multiple exclamation marks are blocked",
    messageText: "Please pay now!!!",
    expectAllowed: false,
    expectReasonContains: "exclamation",
  },
  {
    name: "an all-caps run is blocked",
    messageText: "Please pay your PENDING balance today.",
    expectAllowed: false,
    expectReasonContains: "all-caps",
  },
  {
    name: "boundary: a short real acronym (UPI, 3 letters) does not false-positive as an all-caps run",
    messageText: "You can pay using UPI whenever convenient.",
    expectAllowed: true,
  },
];
