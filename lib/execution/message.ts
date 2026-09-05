// lib/execution/message.ts — orchestrates message generation for one action:
// try Gemini (respecting Phase 6.2's never-throw contract), fall back to a
// plain compliant template on failure, then ALWAYS run the result through
// Rule 9 (tone/content) before considering it dispatched — the second call
// site for that rule described in lib/rules/09-tone-content.ts's header.
import { generateMessage } from "@/lib/ai/generate-message";
import { renderFallbackTemplate, renderDeliberateNaiveTemplate, type TemplateInput } from "./templates";
import { checkToneContent } from "@/lib/rules/09-tone-content";
import { logAuditEvent } from "@/lib/audit/log";
import type { ActionType } from "@/lib/actions/types";
import type { PreferredLanguage } from "@/data/seed/schema";

export type MessageSource = "gemini" | "fallback_template" | "deliberate_naive_demo";

export type MessageOutcome = {
  text: string;
  source: MessageSource;
  toneCheckAllowed: boolean;
  toneCheckReason: string;
};

export type GenerateAndCheckMessageParams = {
  caseId: string;
  actionType: ActionType;
  customerName: string;
  language: PreferredLanguage;
  situationSummary: string;
  templateInput: TemplateInput;
  /** Routes through the deliberately naive/non-compliant template instead of
   * calling the AI — used ONLY for the small seeded Rule-9 demonstration subset. */
  useDeliberateNaiveTemplate?: boolean;
};

export async function generateAndCheckMessage(params: GenerateAndCheckMessageParams): Promise<MessageOutcome> {
  let text: string;
  let source: MessageSource;

  if (params.useDeliberateNaiveTemplate) {
    text = renderDeliberateNaiveTemplate(params.templateInput);
    source = "deliberate_naive_demo";
  } else {
    const aiResult = await generateMessage({
      caseId: params.caseId,
      actionType: params.actionType,
      customerName: params.customerName,
      language: params.language,
      situationSummary: params.situationSummary,
    });
    if (aiResult.success) {
      text = aiResult.text;
      source = "gemini";
    } else {
      text = renderFallbackTemplate(params.actionType, params.language, params.templateInput);
      source = "fallback_template";
    }
  }

  const toneCheck = checkToneContent(text);

  await logAuditEvent({
    case_id: params.caseId,
    layer: "execution",
    event_type: toneCheck.allowed ? "message_generated" : "message_blocked_by_tone_check",
    reasoning_text: toneCheck.reason,
    detail: { source, text, actionType: params.actionType },
  });

  if (!toneCheck.allowed) {
    await logAuditEvent({
      case_id: params.caseId,
      layer: "execution",
      event_type: "routed_to_human_review_queue",
      reasoning_text: `Message failed the tone/content check and was never sent: ${toneCheck.reason}`,
      detail: { source, text },
    });
  }

  return { text, source, toneCheckAllowed: toneCheck.allowed, toneCheckReason: toneCheck.reason };
}
