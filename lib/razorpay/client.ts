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
  | { success: true; shortUrl: string; paymentLinkId: string; amountChargedInr: number }
  | { success: false; reason: string };

// Empirically determined against the real connected test account (Razorpay
// returned "amount exceeds maximum amount allowed" at Rs 20,000 but not at
// Rs 15,000) — a known Razorpay restriction for unverified/newly-created test
// accounts, not something configurable from this codebase. Capping here
// rather than just letting the call fail means more of the batch's
// GENERATE_PAYMENT_LINK actions get a real link instead of silently falling
// back to a template. The capped amount is returned so the caller can keep
// the message text consistent with what the link actually charges — a
// message saying "Rs 26,376" next to a link that only accepts Rs 15,000
// would be worse than either number alone.
export const MAX_TEST_ACCOUNT_AMOUNT_INR = 15000;

// Razorpay's test-account rate limit is tighter than it first looked, and
// not something code alone can fully work around. Testing directly against
// the real account: capping concurrency to 2, then trying a hard minimum
// spacing of 1.1s between every request (with up to 4 retries each) BOTH
// still landed at exactly 5 of 10 successes, at very different total elapsed
// times (8s vs 32s) — consistent with a small rolling quota (roughly 5
// requests per window) rather than a simple concurrency or request-per-second
// limit either fix could realistically satisfy within a batch run's time
// budget. Spacing calls far enough apart to reliably respect an unknown
// quota window would cost tens of seconds to minutes for the ~15-30
// GENERATE_PAYMENT_LINK actions in a full run — not worth it, because the
// project's own bar is "at least one real, working link" (BUILD_MANUAL.md
// Phase 9.2), not "every one succeeds." A light single retry catches the
// occasional transient case without gambling the whole batch's time budget
// on an external quota this codebase doesn't control; the rest fall back to
// the template message, which is the graceful-degradation behavior this
// whole project is built around, not a bug to engineer away.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptCreatePaymentLink(
  params: CreatePaymentLinkParams,
  keyId: string,
  keySecret: string
): Promise<{ status: number; ok: boolean; body: string; data?: { id: string; short_url: string } }> {
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const cappedAmountInr = Math.min(params.amountInr, MAX_TEST_ACCOUNT_AMOUNT_INR);
  const amountPaise = Math.max(100, Math.round(cappedAmountInr * 100)); // Razorpay minimum is 100 paise (Rs 1)

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
      // Razorpay requires reference_id to be unique account-wide, forever —
      // not just "unique among currently active links." Using the bare
      // case_id here meant every re-run of the batch (a core, prominent
      // feature — the "Re-run batch" button) tried to recreate a link with
      // the SAME reference_id as a previous run and got a 400 "already
      // exists," silently degrading more and more real links to the
      // template fallback with each click. Confirmed live on the actual
      // deployed app, not assumed. A per-attempt suffix keeps case_id
      // visible (for the notes field's own case_id, and for anyone reading
      // reference_id directly) while guaranteeing uniqueness across runs.
      reference_id: `${params.caseId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      notes: { source: "firmline", case_id: params.caseId },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { status: response.status, ok: false, body };
  }
  const data = (await response.json()) as { id: string; short_url: string };
  return { status: response.status, ok: true, body: "", data };
}

export async function createTestModePaymentLink(params: CreatePaymentLinkParams): Promise<CreatePaymentLinkResult> {
  const start = Date.now();
  const cappedAmountInr = Math.min(params.amountInr, MAX_TEST_ACCOUNT_AMOUNT_INR);
  try {
    const keyId = process.env.RAZORPAY_TEST_KEY_ID;
    const keySecret = process.env.RAZORPAY_TEST_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new Error("RAZORPAY_TEST_KEY_ID / RAZORPAY_TEST_KEY_SECRET are not configured");
    }

    let lastResult = await attemptCreatePaymentLink(params, keyId, keySecret);
    if (!lastResult.ok && lastResult.status === 429) {
      // One light retry for the occasional transient case — see the
      // rate-limit note above for why this isn't a longer backoff loop.
      await sleep(500 + Math.floor(Math.random() * 500));
      lastResult = await attemptCreatePaymentLink(params, keyId, keySecret);
    }

    if (!lastResult.ok || !lastResult.data) {
      throw new Error(`Razorpay API returned ${lastResult.status}: ${lastResult.body.slice(0, 300)}`);
    }

    const { data } = lastResult;
    const latencyMs = Date.now() - start;
    await logAuditEvent({
      case_id: params.caseId,
      layer: "execution",
      event_type: "razorpay_payment_link_created",
      detail: { latencyMs, paymentLinkId: data.id, shortUrl: data.short_url, requestedAmountInr: params.amountInr, cappedAmountInr },
    });
    return { success: true, shortUrl: data.short_url, paymentLinkId: data.id, amountChargedInr: cappedAmountInr };
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
