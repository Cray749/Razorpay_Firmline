import { check } from "@/lib/test-utils/harness";
import { callClaude } from "./client";
import { resetAuditLogForTests, getAllAuditRowsSync } from "@/lib/audit/log";

async function runAsyncSuite(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  console.log(`  PASS  ${name}`);
}

export default async function run(): Promise<void> {
  await runAsyncSuite("callClaude never throws when ANTHROPIC_API_KEY is missing/invalid", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "";
    resetAuditLogForTests();
    let threw = false;
    let result;
    try {
      result = await callClaude({ purpose: "diagnosis_fallback", system: "test", userMessage: "test", caseId: "test_case" });
    } catch {
      threw = true;
    }
    process.env.ANTHROPIC_API_KEY = original;

    check(!threw, "callClaude must not throw on a missing API key");
    check(result !== undefined && result.success === false, "callClaude must return success:false, not silently succeed");
    const rows = getAllAuditRowsSync();
    check(
      rows.some((r) => r.layer === "claude" && r.event_type === "claude_call_failure"),
      "the failure must be logged to the audit trail"
    );
  });

  console.log("client.test.ts: all assertions passed");
}
