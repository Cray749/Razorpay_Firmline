// lib/ai/diagnose-fallback.ts — the low-level Gemini call used ONLY for
// low-confidence root-cause diagnosis (Phase 5.2 of BUILD_MANUAL.md). This
// call never receives anything about compliance rules — diagnosis only, kept
// narrowly scoped to that one job. Callers must validate the returned label
// against the fixed taxonomy themselves is handled here: an out-of-taxonomy
// label is treated as a call failure, never silently accepted.
import { callGemini } from "./client";

export type DiagnoseFallbackParams = {
  recordType: "payment failure" | "checkout abandonment" | "overdue B2B receivable";
  recordSummary: string; // human-readable description of the record's relevant fields — NEVER includes true_root_cause
  taxonomy: readonly string[];
  caseId: string;
};

export type DiagnoseFallbackResult =
  | { success: true; rootCause: string; reasoning: string }
  | { success: false; reason: string };

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function diagnoseFallback(params: DiagnoseFallbackParams): Promise<DiagnoseFallbackResult> {
  const system = [
    `You are a root-cause diagnosis classifier for Firmline, an AI revenue-recovery agent.`,
    `You diagnose ONLY. You have no information about compliance rules, contact windows, or what action will be taken, and you must not suggest one.`,
    `You must pick EXACTLY ONE label from this fixed list, verbatim, and nothing else: ${params.taxonomy.join(", ")}.`,
    `Respond with ONLY a JSON object of the form {"label": "<one of the fixed labels>", "reasoning": "<one sentence explaining why>"}. No other text.`,
  ].join(" ");

  const userMessage = `Record type: ${params.recordType}\n\n${params.recordSummary}\n\nClassify the root cause using exactly one label from the fixed list.`;

  const result = await callGemini({
    purpose: "diagnosis_fallback",
    system,
    userMessage,
    caseId: params.caseId,
    maxTokens: 300,
  });

  if (!result.success) {
    return { success: false, reason: result.reason };
  }

  let parsed: unknown;
  try {
    parsed = extractJsonObject(result.text);
  } catch (err) {
    return { success: false, reason: `Could not parse Gemini's diagnosis response as JSON: ${err instanceof Error ? err.message : String(err)}` };
  }

  const obj = parsed as { label?: unknown; reasoning?: unknown };
  if (typeof obj.label !== "string" || !params.taxonomy.includes(obj.label)) {
    return { success: false, reason: `Gemini returned a label outside the fixed taxonomy: ${JSON.stringify(obj.label)}` };
  }
  if (typeof obj.reasoning !== "string" || !obj.reasoning.trim()) {
    return { success: false, reason: "Gemini's diagnosis response was missing a reasoning string" };
  }

  return { success: true, rootCause: obj.label, reasoning: obj.reasoning.trim() };
}
