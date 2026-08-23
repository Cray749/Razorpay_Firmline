"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { deriveCaseStatus } from "@/lib/ui/case-status";
import { formatIST } from "@/lib/time/ist";
import type { BatchCaseResult } from "@/lib/batch/run-batch";

type BatchResponse = { hasRun: false } | { hasRun: true; createdAt: string; cases: BatchCaseResult[] };

export default function CounterfactualPage() {
  const [data, setData] = useState<BatchResponse | null>(null);

  useEffect(() => {
    fetch("/api/batch", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return null;

  if (!data.hasRun) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h1 className="text-2xl font-extrabold">No batch run yet</h1>
        <p className="mt-2 text-navy-muted">Run the batch from the home page first.</p>
        <Link href="/" className="mt-6 inline-block rounded-md bg-brass-gold px-5 py-2.5 font-semibold text-ink-navy-deep">
          Go to batch view
        </Link>
      </div>
    );
  }

  const divergent = data.cases.filter((c) => {
    const status = deriveCaseStatus(c);
    return status === "BLOCKED" || status === "PARTIAL";
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-extrabold tracking-tight">Counterfactual: naive agent vs. Firmline</h1>
      <p className="mt-2 max-w-2xl text-navy-muted">
        Same batch, same diagnosis, same decisions — the only difference is whether a compliance gate stood between deciding
        and doing. A naive agent (no gate) sends every proposed action unconditionally, at whatever time it was first
        proposed. Below are every case where that would have produced a different outcome than Firmline actually took.
      </p>

      <p className="mt-4 ledger-numerals text-sm text-navy-muted">
        {divergent.length} of {data.cases.length} cases diverge.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {divergent.map((c) => {
          const blocked = c.actions.filter(
            (a) => !a.isAutoInsertedNotice && (!a.gateResult.allowed || (a.execution?.message && !a.execution.message.toneCheckAllowed))
          );
          return (
            <Link key={c.caseId} href={`/case/${c.caseId}`} className="ledger-card grid grid-cols-1 gap-4 rounded-md p-4 hover:brightness-95 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-stamp-rust">Naive agent — no gate</div>
                <p className="ledger-numerals mt-1 text-xs text-paper-muted">
                  {c.caseId} · {c.customerId}
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {c.naiveActions.map((a, i) => (
                    <li key={i}>
                      Would send <span className="font-semibold">{a.actionType}</span> at{" "}
                      <span className="ledger-numerals">{formatIST(new Date(a.proposedAt))}</span>
                      {a.discountPercent ? ` (${a.discountPercent}% discount)` : ""} — unconditionally.
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-stamp-green">Firmline — gated</div>
                <ul className="mt-1 flex flex-col gap-1 text-sm">
                  {blocked.map((a, i) => (
                    <li key={i}>
                      <span className="font-semibold">{a.proposedAction.actionType}</span> blocked:{" "}
                      {a.gateResult.allowed
                        ? "Rule 9 (tone/content check on the generated message)"
                        : a.gateResult.blockedBy.map((b) => b.ruleName).join(", ")}
                      .{" "}
                      {a.gateResult.rescheduleTo && (
                        <>
                          Rescheduled to <span className="ledger-numerals">{formatIST(new Date(a.gateResult.rescheduleTo))}</span>.
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
