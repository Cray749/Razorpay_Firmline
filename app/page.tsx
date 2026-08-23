"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { StampBadge } from "./_components/StampBadge";
import { deriveCaseStatus, isStampCleared } from "@/lib/ui/case-status";
import type { BatchCaseResult } from "@/lib/batch/run-batch";

type BatchGetResponse =
  | { hasRun: false; seedSize: number }
  | { hasRun: true; batchRunId: string; createdAt: string; cases: BatchCaseResult[] };

const RECORD_TYPE_LABELS: Record<string, string> = {
  payment_failure: "Payment failure",
  checkout_abandonment: "Checkout abandonment",
  b2b_receivable: "B2B receivable",
  circuit_breaker_paused: "Paused (circuit breaker)",
};

const FILTERS = ["all", "payment_failure", "checkout_abandonment", "b2b_receivable"] as const;
type Filter = (typeof FILTERS)[number];

export default function BatchViewPage() {
  const [data, setData] = useState<BatchGetResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    const res = await fetch("/api/batch", { cache: "no-store" });
    const json = (await res.json()) as BatchGetResponse;
    setData(json);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  async function runBatch() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/batch", { method: "POST" });
      if (!res.ok) throw new Error(`Batch run failed: HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const cases = data && data.hasRun ? data.cases : [];
  const filtered = filter === "all" ? cases : cases.filter((c) => c.recordType === filter);

  const clearedCount = cases.filter((c) => isStampCleared(deriveCaseStatus(c))).length;
  const blockedCount = cases.length - clearedCount;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <section className="mb-10">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Firmline</h1>
        <p className="mt-2 max-w-2xl text-navy-muted">
          An AI agent that recovers revenue — and stops the moment it&apos;s not allowed to keep going. Every action below is
          checked against 13 deterministic compliance rules before it runs.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            onClick={runBatch}
            disabled={running}
            className="rounded-md bg-brass-gold px-5 py-2.5 font-semibold text-ink-navy-deep disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass-gold"
          >
            {running ? "Running batch…" : data?.hasRun ? "Re-run batch" : "Run the batch"}
          </button>
          {data && !data.hasRun && (
            <span className="text-sm text-navy-muted">{data.seedSize} synthetic records loaded, ready to run.</span>
          )}
          {data && data.hasRun && (
            <span className="text-sm text-navy-muted ledger-numerals">
              Last run: {new Date(data.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
            </span>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-stamp-rust">{error}</p>}

        <p className="mt-4 text-xs text-navy-muted">
          This runs against a synthetic batch of Indian payment data in Razorpay test mode. No real money moves, and no real
          messages are sent to real phone numbers or email addresses.
        </p>
      </section>

      {data?.hasRun && cases.length > 0 && (
        <>
          <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile label="Total cases" value={cases.length} />
            <StatTile label="Cleared" value={clearedCount} accent="green" />
            <StatTile label="Blocked / rescheduled" value={blockedCount} accent="rust" />
            <StatTile label="Needs human review" value={cases.filter((c) => c.needsHumanReview).length} />
          </section>

          <section className="mb-4 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  filter === f ? "bg-brass-gold text-ink-navy-deep font-semibold" : "bg-ink-navy-raised text-navy-muted hover:text-navy-text"
                }`}
              >
                {f === "all" ? "All" : RECORD_TYPE_LABELS[f]}
              </button>
            ))}
            <Link href="/dashboard" className="ml-auto rounded-md px-3 py-1.5 text-sm text-navy-muted hover:text-navy-text">
              View dashboard →
            </Link>
          </section>

          <section className="grid gap-2">
            {filtered.map((c, i) => {
              const status = deriveCaseStatus(c);
              return (
                <Link
                  key={c.caseId}
                  href={`/case/${c.caseId}`}
                  className="ledger-card flex flex-wrap items-center justify-between gap-3 rounded-md px-4 py-3 hover:brightness-95 transition-[filter]"
                  style={{ animationDelay: `${Math.min(i, 40) * 15}ms` }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="ledger-numerals text-xs text-paper-muted">{c.caseId}</span>
                    <span className="truncate font-medium">{c.customerId}</span>
                    <span className="hidden text-xs text-paper-muted sm:inline">{RECORD_TYPE_LABELS[c.recordType]}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="ledger-numerals text-xs text-paper-muted">{c.rootCause}</span>
                    <StampBadge cleared={isStampCleared(status)} label={status.replace("_", " ")} animate={i < 24} />
                  </div>
                </Link>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: number; accent?: "green" | "rust" }) {
  const color = accent === "green" ? "text-stamp-green" : accent === "rust" ? "text-stamp-rust" : "text-navy-text";
  return (
    <div className="ledger-card rounded-md px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-paper-muted">{label}</div>
      <div className={`ledger-numerals text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
