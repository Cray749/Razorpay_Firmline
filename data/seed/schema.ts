// data/seed/schema.ts — SCHEMA VERSION 1. Bump this comment and the SEED_SCHEMA_VERSION
// constant below if you ever change a field. Do not change fields silently.

export const SEED_SCHEMA_VERSION = 1;

export type PreferredLanguage = "en" | "hi-en";
export type CustomerSegment = "standard" | "at_risk" | "high_value";

export type PaymentFailure = {
  id: string; // e.g. "pf_0001"
  customer_id: string;
  customer_name: string;
  customer_phone: string; // the ONE verified contact — used by Rule 5
  customer_email: string;
  preferred_language: PreferredLanguage;
  amount_inr: number;
  mandate_id: string;
  mandate_max_amount_inr: number;
  mandate_expiry: string; // ISO timestamp
  failure_code:
    | "INSUFFICIENT_FUNDS"
    | "RISK_DECLINED"
    | "GATEWAY_TIMEOUT"
    | "MANDATE_EXPIRED"
    | "PIN_INCORRECT"
    | "UNKNOWN";
  attempted_at: string; // ISO timestamp, IST — deliberately include some outside 8AM-7PM and inside NPCI peak windows
  previous_attempts_today: number;
  previous_attempts_total_21d: number;
  is_opted_out: boolean;
  is_disputed: boolean; // triggers Rule 13 if true
  last_contact_status: "DELIVERED" | "FAILED_INVALID_NUMBER" | "NO_PRIOR_CONTACT"; // drives Rule 12
  customer_segment: CustomerSegment; // drives Rule 10 discount bands
  true_root_cause: string; // ground truth label — NEVER passed to the classifier, only used for scoring
};

export type CheckoutAbandonment = {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  preferred_language: PreferredLanguage;
  cart_value_inr: number;
  time_on_payment_page_sec: number;
  sessions_count: number;
  payment_method_attempted: string | null;
  abandoned_at: string;
  is_opted_out: boolean;
  customer_segment: CustomerSegment;
  true_root_cause: string;
};

export type B2BReceivable = {
  id: string;
  business_name: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  preferred_language: PreferredLanguage;
  invoice_amount_inr: number;
  invoice_due_date: string;
  days_overdue: number;
  payment_history_pattern: "always_on_time" | "frequently_late" | "first_invoice";
  dispute_flag: boolean;
  is_opted_out: boolean;
  true_root_cause: string;
};

export type SeedBatch = {
  schema_version: number;
  generated_at: string;
  random_seed: number;
  payment_failures: PaymentFailure[];
  checkout_abandonments: CheckoutAbandonment[];
  b2b_receivables: B2BReceivable[];
};
