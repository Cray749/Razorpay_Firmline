// lib/razorpay/client.ts — the one real external integration worth doing
// (BUILD_MANUAL.md Phase 9.2 / README "What's actually new"): a genuine
// Razorpay TEST-MODE Payment Links API call for GENERATE_PAYMENT_LINK
// actions. No SDK dependency — the fixed tech stack doesn't list one, and a
// single REST call doesn't need one.
//
// `notify: { sms: false, email: false }` is deliberate: the seed data's
// phone numbers/emails are synthetic, and per the manual's scope discipline
// ("No real outbound messages to real phone numbers or email addresses"),
// Razorpay itself must never attempt to actually deliver anything to them —
// we render the returned link ourselves, inside the simulated message UI.
import { logAuditEvent } from "@/lib/audit/log";

export type CreatePaymentLinkParams = {
  caseId: string;
  amountInr: number;
  description: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
};

export type CreatePaymentLinkResult =
  | { success: true; shortUrl: string; paymentLinkId: string }
  | { success: false; reason: string };

export async function createTestModePaymentLink(params: CreatePaymentLinkParams): Promise<CreatePaymentLinkResult> {
  const start = Date.now();
  try {
    const keyId = process.env.RAZORPAY_TEST_KEY_ID;
    const keySecret = process.env.RAZORPAY_TEST_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new Error("RAZORPAY_TEST_KEY_ID / RAZORPAY_TEST_KEY_SECRET are not configured");
    }
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const amountPaise = Math.max(100, Math.round(params.amountInr * 100)); // Razorpay minimum is 100 paise (Rs 1)

    const response = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        description: params.description,
        customer: {
          name: params.customerName,
          email: params.customerEmail ?? undefined,
          contact: params.customerPhone ?? undefined,
        },
        notify: { sms: false, email: false },
        reference_id: params.caseId,
        notes: { source: "firmline", case_id: params.caseId },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Razorpay API returned ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = (await response.json()) as { id: string; short_url: string };
    const latencyMs = Date.now() - start;
    await logAuditEvent({
      case_id: params.caseId,
      layer: "execution",
      event_type: "razorpay_payment_link_created",
      detail: { latencyMs, paymentLinkId: data.id, shortUrl: data.short_url, amountPaise },
    });
    return { success: true, shortUrl: data.short_url, paymentLinkId: data.id };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const reason = err instanceof Error ? err.message : String(err);
    await logAuditEvent({
      case_id: params.caseId,
      layer: "execution",
      event_type: "razorpay_payment_link_failed",
      detail: { latencyMs, reason },
    });
    return { success: false, reason };
  }
}
