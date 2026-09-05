// lib/ai/generate-message.ts — the low-level Gemini call for generating
// recovery message text (BUILD_MANUAL.md Phase 9.1). Explicitly instructed to
// avoid urgency/guilt/fake-scarcity/legal-action language so messages pass
// Rule 9 by construction, not by luck. Generates Hinglish when the customer's
// preferred_language is hi-en.
import { callGemini } from "./client";
import type { PreferredLanguage } from "@/data/seed/schema";
import type { ActionType } from "@/lib/actions/types";

export type GenerateMessageParams = {
  caseId: string;
  actionType: ActionType;
  customerName: string;
  language: PreferredLanguage;
  /** Plain-language context for what happened and what this message should
   * cover — e.g. "Payment of Rs 999 failed due to insufficient balance. We
   * will retry automatically. Include a soft, no-pressure reminder." */
  situationSummary: string;
};

export type GenerateMessageResult = { success: true; text: string } | { success: false; reason: string };

export async function generateMessage(params: GenerateMessageParams): Promise<GenerateMessageResult> {
  const system = [
    `You write short outbound recovery messages for Firmline, an AI agent that helps Indian merchants recover at-risk revenue.`,
    `Hard rules, no exceptions: NEVER use urgency language (e.g. "immediately", "right now", multiple exclamation marks), NEVER use guilt language, NEVER use fake scarcity, NEVER mention legal action, reporting, consequences, or anything threatening or shaming.`,
    `Keep the tone warm, respectful, and calm — like a considerate business, not a collections agency.`,
    `Keep the message under 350 characters, plain text, no markdown.`,
    params.language === "hi-en"
      ? `Write in Hinglish — Hindi mixed with English, in Latin script (roman letters), the way Indian customers actually text each other. Not formal Hindi, not pure English.`
      : `Write in plain English.`,
  ].join(" ");

  const userMessage = `Customer name: ${params.customerName}\nAction type: ${params.actionType}\nSituation: ${params.situationSummary}\n\nWrite the message now, following the hard rules exactly.`;

  const result = await callGemini({ purpose: "message_generation", system, userMessage, caseId: params.caseId, maxTokens: 250 });
  if (!result.success) {
    return { success: false, reason: result.reason };
  }
  return { success: true, text: result.text.trim() };
}
