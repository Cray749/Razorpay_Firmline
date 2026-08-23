// lib/claude/client.ts — the ONLY place in this codebase allowed to call the
// Anthropic SDK directly. Every feature that needs Claude (diagnosis fallback,
// message generation) goes through `callClaude` here.
//
// Contract: this function never throws. On any failure — missing API key, rate
// limit, timeout, network error, malformed response — it returns
// `{ success: false, reason }` instead of crashing the batch run. Callers are
// responsible for falling back to a safe default (see lib/claude/diagnose-fallback.ts
// and lib/claude/generate-message.ts). Every call, successful or not, is logged
// with latency and outcome via the audit trail.
import Anthropic from "@anthropic-ai/sdk";
import { logAuditEvent } from "@/lib/audit/log";

export const CLAUDE_MODEL = "claude-sonnet-5";

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return cachedClient;
}

export type ClaudeCallResult =
  | { success: true; text: string; latencyMs: number }
  | { success: false; reason: string; latencyMs: number };

export type CallClaudeParams = {
  /** What this call is for — logged, and useful for grep-ing the audit trail. */
  purpose: "diagnosis_fallback" | "message_generation";
  system: string;
  userMessage: string;
  maxTokens?: number;
  /** Case this call is for, if any (null for calls not tied to one record). */
  caseId?: string | null;
};

export async function callClaude(params: CallClaudeParams): Promise<ClaudeCallResult> {
  const start = Date.now();
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    const response = await getClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: params.maxTokens ?? 600,
      system: params.system,
      messages: [{ role: "user", content: params.userMessage }],
    });
    const latencyMs = Date.now() - start;
    const textBlock = response.content.find((block) => block.type === "text");
    const text = textBlock && "text" in textBlock ? textBlock.text.trim() : "";
    if (!text) {
      throw new Error("Claude response contained no usable text content");
    }
    await logAuditEvent({
      case_id: params.caseId ?? null,
      layer: "claude",
      event_type: "claude_call_success",
      detail: { purpose: params.purpose, latencyMs, model: CLAUDE_MODEL },
    });
    return { success: true, text, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const reason = err instanceof Error ? err.message : String(err);
    await logAuditEvent({
      case_id: params.caseId ?? null,
      layer: "claude",
      event_type: "claude_call_failure",
      detail: { purpose: params.purpose, latencyMs, model: CLAUDE_MODEL, reason },
    });
    return { success: false, reason, latencyMs };
  }
}
