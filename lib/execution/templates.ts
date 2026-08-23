// lib/execution/templates.ts — plain, pre-written, non-personalized fallback
// templates used when Claude message generation fails (lib/claude/client.ts's
// contract: never block the record, fall back to a safe default). Written to
// pass Rule 9 by construction — no urgency, no guilt, no fake scarcity, no
// legal-action phrasing.
import type { ActionType } from "@/lib/actions/types";
import type { PreferredLanguage } from "@/data/seed/schema";

export type TemplateInput = {
  customerName: string;
  amountInr?: number;
  discountPercent?: number;
  paymentLinkUrl?: string;
};

type TemplateFn = (input: TemplateInput) => string;

const EN_TEMPLATES: Partial<Record<ActionType, TemplateFn>> = {
  SEND_SOFT_REMINDER: (i) => `Hi ${i.customerName}, just a gentle reminder about your recent payment${i.amountInr ? ` of Rs ${i.amountInr}` : ""}. Let us know if we can help in any way.`,
  SEND_PRE_DEBIT_NOTICE_THEN_RETRY: (i) => `Hi ${i.customerName}, we'll be retrying your payment${i.amountInr ? ` of Rs ${i.amountInr}` : ""} in the next 24 hours. No action needed if your account is funded.`,
  OFFER_APPROVED_DISCOUNT: (i) => `Hi ${i.customerName}, as a thank-you for considering us, here's ${i.discountPercent ?? 5}% off if you'd like to complete your purchase.`,
  REQUEST_NEW_PAYMENT_METHOD: (i) => `Hi ${i.customerName}, your payment method on file didn't go through. Whenever it's convenient, you can update it here.`,
  GENERATE_PAYMENT_LINK: (i) => `Hi ${i.customerName}, here's a secure link to complete your payment${i.amountInr ? ` of Rs ${i.amountInr}` : ""}: ${i.paymentLinkUrl ?? "[link]"}`,
  OFFER_PAYMENT_PLAN: (i) => `Hi ${i.customerName}, if it helps, we're happy to split your outstanding balance${i.amountInr ? ` of Rs ${i.amountInr}` : ""} into a payment plan. Let us know.`,
  CAPTURE_PROMISE_TO_PAY: (i) => `Hi ${i.customerName}, thanks for confirming — we've noted your payment date and won't follow up until then.`,
};

const HINGLISH_TEMPLATES: Partial<Record<ActionType, TemplateFn>> = {
  SEND_SOFT_REMINDER: (i) => `Hi ${i.customerName}, aapka recent payment${i.amountInr ? ` (Rs ${i.amountInr})` : ""} ke baare mein ek chhota sa reminder. Koi help chahiye toh batayein.`,
  SEND_PRE_DEBIT_NOTICE_THEN_RETRY: (i) => `Hi ${i.customerName}, hum aapka payment${i.amountInr ? ` (Rs ${i.amountInr})` : ""} agle 24 hours mein retry karenge. Agar account mein balance hai toh kuch karne ki zaroorat nahi.`,
  OFFER_APPROVED_DISCOUNT: (i) => `Hi ${i.customerName}, aapke liye ${i.discountPercent ?? 5}% ka discount available hai agar aap purchase complete karna chahein.`,
  REQUEST_NEW_PAYMENT_METHOD: (i) => `Hi ${i.customerName}, aapka payment method work nahi kar paaya. Jab convenient ho, yahan update kar sakte hain.`,
  GENERATE_PAYMENT_LINK: (i) => `Hi ${i.customerName}, yeh raha aapka secure payment link${i.amountInr ? ` (Rs ${i.amountInr})` : ""}: ${i.paymentLinkUrl ?? "[link]"}`,
  OFFER_PAYMENT_PLAN: (i) => `Hi ${i.customerName}, agar madad ho toh hum aapka balance${i.amountInr ? ` (Rs ${i.amountInr})` : ""} installments mein split kar sakte hain. Batayein.`,
  CAPTURE_PROMISE_TO_PAY: (i) => `Hi ${i.customerName}, confirm karne ke liye shukriya — humne aapki payment date note kar li hai.`,
};

export function renderFallbackTemplate(actionType: ActionType, language: PreferredLanguage, input: TemplateInput): string {
  const table = language === "hi-en" ? HINGLISH_TEMPLATES : EN_TEMPLATES;
  const fn = table[actionType] ?? EN_TEMPLATES[actionType];
  if (!fn) {
    return `Hi ${input.customerName}, we're following up on your account. Please reach out if we can help.`;
  }
  return fn(input);
}

/**
 * Deliberately naive/non-compliant template, used ONLY for the small seeded
 * Rule-9 demonstration subset (see data/seed/generate.ts's isToneDemoCase and
 * lib/execution/message.ts) — mimics what a careless recovery bot might send,
 * so the tone/content rule has real, deterministic content to catch in the
 * batch run, independent of Claude's (compliant-by-instruction) output.
 */
export function renderDeliberateNaiveTemplate(input: TemplateInput): string {
  return `URGENT: This is your FINAL NOTICE. Dear ${input.customerName}, your overdue balance of Rs ${input.amountInr ?? 0} must be paid IMMEDIATELY!! Legal action will be taken if payment is not received right away!!`;
}
