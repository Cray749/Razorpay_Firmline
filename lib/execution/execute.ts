// lib/execution/execute.ts — carries out ONE already-gate-allowed action:
// generates and tone-checks the message (if the action type has one),
// creates a real Razorpay test-mode payment link (if GENERATE_PAYMENT_LINK),
// and logs the final outcome. The caller (lib/batch/run-batch.ts) is
// responsible for the gate check itself and for Rule 6's auto-insert/
// reschedule handling — this module assumes "the gate said yes."
import type { ActionType, ProposedAction } from "@/lib/actions/types";
import type { PreferredLanguage } from "@/data/seed/schema";
import { generateAndCheckMessage, type MessageOutcome } from "./message";
import { createTestModePaymentLink, type CreatePaymentLinkResult } from "@/lib/razorpay/client";
import { logAuditEvent, AUDIT_EVENT_TYPES } from "@/lib/audit/log";
import type { TemplateInput } from "./templates";

export const MESSAGE_ACTION_TYPES: ActionType[] = [
  "SEND_SOFT_REMINDER",
  "SEND_PRE_DEBIT_NOTICE_THEN_RETRY",
  "OFFER_APPROVED_DISCOUNT",
  "REQUEST_NEW_PAYMENT_METHOD",
  "GENERATE_PAYMENT_LINK",
  "OFFER_PAYMENT_PLAN",
  "CAPTURE_PROMISE_TO_PAY",
];

export type ExecuteActionParams = {
  action: ProposedAction;
  customerName: string;
  language: PreferredLanguage;
  amountInr?: number;
  discountPercent?: number;
  useDeliberateNaiveTemplate?: boolean;
};

export type ExecutionOutcome = {
  dispatched: boolean;
  message?: MessageOutcome;
  paymentLink?: CreatePaymentLinkResult;
};

function situationSummaryFor(actionType: ActionType, rootCause: string, amountInr?: number, discountPercent?: number): string {
  const amountPart = amountInr ? ` The amount involved is Rs ${amountInr}.` : "";
  switch (actionType) {
    case "SEND_SOFT_REMINDER":
      return `The customer's payment or invoice needs a gentle follow-up (root cause: ${rootCause}).${amountPart} Write a brief, warm reminder with no pressure.`;
    case "SEND_PRE_DEBIT_NOTICE_THEN_RETRY":
      return `We are required to notify the customer at least 24 hours before retrying a mandate charge.${amountPart} Write a short, informational notice.`;
    case "OFFER_APPROVED_DISCOUNT":
      return `The customer abandoned checkout, likely due to price sensitivity.${amountPart} Offer a ${discountPercent ?? 5}% discount if they'd like to complete the purchase, warmly and with no pressure.`;
    case "REQUEST_NEW_PAYMENT_METHOD":
      return `The customer's payment method (mandate/card) has expired or been revoked.${amountPart} Ask them to update their payment method whenever convenient.`;
    case "GENERATE_PAYMENT_LINK":
      return `The customer had trouble completing payment.${amountPart} Share that a secure payment link is available; the link itself will be appended separately.`;
    case "OFFER_PAYMENT_PLAN":
      return `The customer has a cash-flow-related delay on an overdue invoice.${amountPart} Offer to split the balance into a payment plan, supportively.`;
    case "CAPTURE_PROMISE_TO_PAY":
      return `The customer has verbally promised to pay by a certain date.${amountPart} Send a brief, friendly confirmation that we've noted it.`;
    default:
      return `Follow up with the customer regarding root cause: ${rootCause}.${amountPart}`;
  }
}

export async function executeAllowedAction(params: ExecuteActionParams): Promise<ExecutionOutcome> {
  const { action } = params;

  if (!MESSAGE_ACTION_TYPES.includes(action.actionType) || !action.contactTarget) {
    await logAuditEvent({
      case_id: action.caseId,
      customer_id: action.customerId,
      layer: "execution",
      event_type: "executed_no_message",
      reasoning_text: `Action ${action.actionType} carried out with no customer-facing message (internal/system action).`,
    });
    return { dispatched: true };
  }

  let paymentLink: CreatePaymentLinkResult | undefined;
  if (action.actionType === "GENERATE_PAYMENT_LINK") {
    paymentLink = await createTestModePaymentLink({
      caseId: action.caseId,
      amountInr: params.amountInr ?? 0,
      description: `Firmline recovery — ${action.caseId}`,
      customerName: params.customerName,
      customerEmail: action.contactTarget.channel === "email" ? action.contactTarget.address : null,
      customerPhone: action.contactTarget.channel !== "email" ? action.contactTarget.address : null,
    });
  }

  // When a real payment link was created, the amount it actually charges may
  // have been capped (see MAX_TEST_ACCOUNT_AMOUNT_INR in lib/razorpay/client.ts
  // — the connected test account rejects amounts above Rs 15,000). The
  // message must quote that same capped figure, not the original record
  // amount, or it would promise a number the link itself won't accept.
  const effectiveAmountInr = paymentLink?.success ? paymentLink.amountChargedInr : params.amountInr;

  const templateInput: TemplateInput = {
    customerName: params.customerName,
    amountInr: effectiveAmountInr,
    discountPercent: params.discountPercent,
    paymentLinkUrl: paymentLink?.success ? paymentLink.shortUrl : undefined,
  };

  const message = await generateAndCheckMessage({
    caseId: action.caseId,
    actionType: action.actionType,
    customerName: params.customerName,
    language: params.language,
    situationSummary: situationSummaryFor(action.actionType, action.rootCause, effectiveAmountInr, params.discountPercent),
    templateInput,
    useDeliberateNaiveTemplate: params.useDeliberateNaiveTemplate,
  });

  if (action.actionType === "SEND_PRE_DEBIT_NOTICE_THEN_RETRY" && message.toneCheckAllowed && action.mandateId) {
    await logAuditEvent({
      case_id: action.caseId,
      customer_id: action.customerId,
      mandate_id: action.mandateId,
      layer: "execution",
      event_type: AUDIT_EVENT_TYPES.PRE_DEBIT_NOTICE_SENT,
      reasoning_text: `Pre-debit notice dispatched for mandate ${action.mandateId}.`,
      timestamp: action.proposedAt,
    });
  }

  if (message.toneCheckAllowed) {
    await logAuditEvent({
      case_id: action.caseId,
      customer_id: action.customerId,
      channel: action.contactTarget.channel,
      layer: "execution",
      event_type: AUDIT_EVENT_TYPES.CONTACT_ATTEMPT,
      reasoning_text: `Message dispatched via ${action.contactTarget.channel} (simulated).`,
      timestamp: action.proposedAt,
    });
  }

  return { dispatched: message.toneCheckAllowed, message, paymentLink };
}
