// lib/ai/client.ts — the ONLY place in this codebase allowed to call the
// Google Gemini SDK directly. Every feature that needs an LLM (diagnosis
// fallback, message generation) goes through `callGemini` here.
//
// Originally built against Anthropic's Claude API (matching this project's
// build manual's stated tech stack). Swapped to Gemini's free tier — Google
// AI Studio issues API keys with no credit card required, and the per-call
// cost of this project (~124 short calls per full batch run) made a paid key
// an unnecessary expense for a buildathon submission. Gemini 2.5 Flash was
// chosen over Groq's free tier (open-weight models) for closer instruction-
// following quality on the tone/language constraints message generation
// depends on. The provider name changed; the never-throw, always-logged
// contract from the original design did not.
//
// Contract: this function never throws. On any failure — missing API key,
// rate limit, timeout, network error, malformed response — it returns
// `{ success: false, reason }` instead of crashing the batch run. Callers are
// responsible for falling back to a safe default (see lib/ai/diagnose-fallback.ts
// and lib/ai/generate-message.ts). Every call, successful or not, is logged
// with latency and outcome via the audit trail.
import { GoogleGenAI } from "@google/genai";
import { logAuditEvent } from "@/lib/audit/log";

// Model chosen by live-testing against a real key, not guessed:
// - "gemini-2.5-flash" (this project's original choice) returned a 404 —
//   "no longer available to new users... use models/gemini-3.6-flash."
// - "gemini-3.6-flash" (the flagship-tier model Google's own error pointed
//   to) DOES work, but its free tier is only 20 requests/day — nowhere near
//   this project's ~124-call-per-batch-run volume.
// - "gemini-flash-lite-latest" (an alias Google keeps pointed at its current
//   recommended lite-tier model) produces correct, well-formed JSON output
//   and is the tier actually designed for high-volume, low-cost use — the
//   right fit here, not just the first thing that returned a 200.
// GEMINI_MODEL stays overridable via env var so a future deprecation or
// quota change doesn't require another code change.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

let cachedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return cachedClient;
}

export type AiCallResult =
  | { success: true; text: string; latencyMs: number }
  | { success: false; reason: string; latencyMs: number };

export type CallGeminiParams = {
  /** What this call is for — logged, and useful for grep-ing the audit trail. */
  purpose: "diagnosis_fallback" | "message_generation";
  system: string;
  userMessage: string;
  maxTokens?: number;
  /** Case this call is for, if any (null for calls not tied to one record). */
  caseId?: string | null;
};

export async function callGemini(params: CallGeminiParams): Promise<AiCallResult> {
  const start = Date.now();
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    const response = await getClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: params.userMessage,
      config: {
        systemInstruction: params.system,
        maxOutputTokens: params.maxTokens ?? 600,
      },
    });
    const latencyMs = Date.now() - start;
    const text = (response.text ?? "").trim();
    if (!text) {
      throw new Error("Gemini response contained no usable text content");
    }
    await logAuditEvent({
      case_id: params.caseId ?? null,
      layer: "ai",
      event_type: "ai_call_success",
      detail: { purpose: params.purpose, latencyMs, model: GEMINI_MODEL, provider: "gemini" },
    });
    return { success: true, text, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const reason = err instanceof Error ? err.message : String(err);
    await logAuditEvent({
      case_id: params.caseId ?? null,
      layer: "ai",
      event_type: "ai_call_failure",
      detail: { purpose: params.purpose, latencyMs, model: GEMINI_MODEL, provider: "gemini", reason },
    });
    return { success: false, reason, latencyMs };
  }
}
